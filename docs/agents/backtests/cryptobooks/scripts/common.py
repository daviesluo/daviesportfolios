# CRYPTOBOOKS (2026-10-31): shared loaders. The outside fair of a Revolut X book at second s is Binance's last trade of
# COIN-USDT in second s (binance_1s.py), times USDT's dollar price (Coinbase USDT-USD minute closes, committed by MMCOMP),
# divided by GBP/USD for a GBP book (Yahoo's minute closes committed by REVX-FAIR to 2026-10-28 23:57, then TrueFX's
# minutes from the production FX recorder, data/fx_truefx_gbpusd.txt.gz), each minute series carried forward.
import array, bisect, gzip, json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
BT = os.path.normpath(os.path.join(ROOT, ".."))
BN_DIR = os.environ.get("CRYPTOBOOKS_BN", os.path.join(ROOT, "bn"))  # binance_1s.py's output (not committed)
HALT = (1792476000, 1792514100)  # 2026-10-20 06:00 -> 16:35 UTC, the venue-wide halt (MAKER-OTHER-BOOKS §1.4)


class Minutes:
    def __init__(self, pts):
        pts.sort()
        self.t = [p[0] for p in pts]
        self.v = [p[1] for p in pts]

    def at(self, sec):
        i = bisect.bisect_right(self.t, sec) - 1
        return self.v[max(i, 0)]


def load_fx():
    pts = []
    with gzip.open(os.path.join(BT, "fair_price", "data", "fx.txt.gz"), "rt") as f:
        for line in f:
            a, b = line.strip().split("|")
            pts.append((int(a) // 1000, float(b)))
    last_yahoo = pts[-1][0] if pts else 0
    with gzip.open(os.path.join(ROOT, "data", "fx_truefx_gbpusd.txt.gz"), "rt") as f:
        for line in f:
            a, b = line.strip().split("|")
            if int(a) // 1000 > last_yahoo:
                pts.append((int(a) // 1000, float(b)))
    return Minutes(pts)


def load_usdt():
    pts = []
    with gzip.open(os.path.join(BT, "mmcomp", "data", "other_cb_usdt_usd.txt.gz"), "rt") as f:
        for line in f:
            a, b = line.strip().split("|")
            pts.append((int(a) // 1000, float(b)))
    return Minutes(pts)


class Fair:
    """fair(book, s): the outside price of BOOK's coin in BOOK's quote currency at the end of UTC second s."""

    def __init__(self):
        idx = json.load(open(os.path.join(BN_DIR, "index.json")))
        self.t0 = idx["t0"]
        self.bn = {}
        for c in idx["coins"]:
            a = array.array("d")
            with open(os.path.join(BN_DIR, f"{c}.f64"), "rb") as f:
                a.frombytes(f.read())
            self.bn[c] = a
        self.n = len(next(iter(self.bn.values())))
        self.t1 = self.t0 + self.n
        self.fx = load_fx()
        self.usdt = load_usdt()
        self._cache = {}

    def series(self, book):
        """One float a second over the whole window, in the book's quote currency."""
        if book in self._cache:
            return self._cache[book]
        coin, quote = book.split("-")
        bn = self.bn[coin]
        out = array.array("d", bn)
        for m0 in range(0, self.n, 60):
            sec = self.t0 + m0
            k = self.usdt.at(sec)
            if quote == "GBP":
                k /= self.fx.at(sec)
            for i in range(m0, min(m0 + 60, self.n)):
                out[i] *= k
        self._cache[book] = out
        return out


def load_tape(book, tag=""):
    """Revolut X UK prints of BOOK, oldest first: (ms, price, qty, +1 taker buy / -1 taker sell); TAG "1031" reads the
    separate pull of 2026-10-31 (data/tape1031_<BOOK>.txt.gz)."""
    rows = []
    with gzip.open(os.path.join(ROOT, "data", f"tape{tag}_{book}.txt.gz"), "rt") as f:
        for line in f:
            p = line.rstrip("\n").split("|")
            if len(p) < 5:
                continue
            rows.append((int(p[1]), float(p[2]), float(p[3]), 1 if p[4] == "buy" else -1))
    rows.sort()
    return rows


def takers(tape):
    """Prints of one taker order (same ms, same side) folded into one: (ms, worst price, qty, side, vwap, n prints)."""
    out = []
    for ms, p, q, s in tape:
        if out and out[-1][0] == ms and out[-1][3] == s:
            o = out[-1]
            q2 = o[2] + q
            out[-1] = (ms, max(o[1], p) if s > 0 else min(o[1], p), q2, s, (o[4] * o[2] + p * q) / q2, o[5] + 1)
        else:
            out.append((ms, p, q, s, p, 1))
    return out


def taker_orders(tape):
    """As takers(), keeping each order's prints: (ms, side, [(price, qty), ...]) in the order the book filled them."""
    out = []
    for ms, p, q, s in tape:
        if out and out[-1][0] == ms and out[-1][1] == s:
            out[-1][2].append((p, q))
        else:
            out.append((ms, s, [(p, q)]))
    for o in out:
        o[2].sort(key=lambda x: x[0] * o[1])  # a buy meets the lowest asks first, a sell the highest bids
    return out


def in_halt(sec):
    return HALT[0] <= sec < HALT[1]


def bps(x):
    return 1e4 * math.log(x)


def pct(v, q):
    if not v:
        return None
    v = sorted(v)
    return v[min(len(v) - 1, max(0, int(q * (len(v) - 1) + 0.5)))]
