# MMCOMP (2026-10-30): loaders over files already committed by earlier studies; nothing here reads the network or the database.
#   prints  : PR5's committed UK tape (inputs/pr5_2026-09-23/trades, USDC-GBP from 2025-10-01, USDT-GBP from 2025-12-10, to
#             2026-09-22) joined by id with REVX-FAIR's stored prints (fair_price/data/prints.txt.gz, 2026-09-22 -> 2026-10-29 00:00)
#   gbpusd  : Exness one-minute mids (inputs/pr5_2026-09-23/fx/series_EXN.json.gz, to 2026-09-22) then Yahoo's one-minute bars
#             as PR5 stored them (fair_price/data/fx.txt.gz, 2026-09-22 ->)
#   usd     : Revolut X's USDC-USD / USDT-USD hourly closes (inputs/pr5_2026-09-23/candles, then fair_price/data/hours.txt.gz)
#   book    : Revolut X's five-level book snapshots (fair_price/data/book_<BOOK>.txt.gz, 2026-09-26 ->)
#   cb      : Coinbase's touch each minute (fair_price/data/cb_<BOOK>.txt.gz, 2026-10-10 ->)
import bisect, gzip, json, math, os

BT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
P5 = os.path.join(BT, "inputs", "pr5_2026-09-23")
FP = os.path.join(BT, "fair_price", "data")
TICK = 0.0001
DAY = 86_400_000


def prints(book):
    """[(ms, price, qty, side, id)] sorted, de-duplicated by id."""
    rows = {}
    for line in gzip.open(os.path.join(P5, "trades", f"{book}.jsonl.gz"), "rt"):
        r = json.loads(line)
        rows[r["id"]] = (int(r["ts"]), float(r["price"]), float(r["qty"]), r["side"], r["id"])
    for line in gzip.open(os.path.join(FP, "prints.txt.gz"), "rt"):
        f = line.rstrip("\n").split("|")
        if len(f) < 6 or f[1] != book:
            continue
        rows[f[0]] = (int(f[2]), float(f[3]), float(f[4]), f[5], f[0])
    return sorted(rows.values())


class Series:
    """A step series of (ms, value): value_at(t) is the last value at or before t, None before the first or when older than max_age."""

    def __init__(self, pts, max_age=None):
        pts = sorted(pts)
        self.t = [p[0] for p in pts]
        self.v = [p[1] for p in pts]
        self.max_age = max_age

    def at(self, t):
        i = bisect.bisect_right(self.t, t) - 1
        if i < 0:
            return None
        if self.max_age is not None and t - self.t[i] > self.max_age:
            return None
        return self.v[i]


def gbpusd():
    pts = [(int(t), float(v)) for t, v in json.load(gzip.open(os.path.join(P5, "fx", "series_EXN.json.gz")))]
    last = pts[-1][0]
    for line in gzip.open(os.path.join(FP, "fx.txt.gz"), "rt"):
        t, v = line.strip().split("|")
        if int(t) > last:
            pts.append((int(t), float(v)))
    return Series(pts, max_age=10 * 60_000)   # an FX closure gives None


def usd(book):
    sym = {"USDC-GBP": "USDC-USD", "USDT-GBP": "USDT-USD"}[book]
    c = json.load(gzip.open(os.path.join(P5, "candles", f"{sym}_60.json.gz")))
    pts = [(int(r["start"]) + 3_600_000, float(r["close"])) for r in c["rows"]]
    last = pts[-1][0]
    for line in gzip.open(os.path.join(FP, "hours.txt.gz"), "rt"):
        k, t, v = line.strip().split("|")
        if k == f"fair:{sym}" and int(t) + 3_600_000 > last:
            pts.append((int(t) + 3_600_000, float(v)))
    # the 24-hour median, as PR5's fairU
    pts.sort()
    out, win = [], []
    for t, v in pts:
        win.append((t, v))
        win = [w for w in win if w[0] > t - DAY]
        vals = sorted(w[1] for w in win)
        out.append((t, vals[len(vals) // 2]))
    return Series(out, max_age=3 * 3_600_000)


def book(book):
    """[(ms, bids, asks)] with each side [(price, qty, orders)] best first."""
    out = []
    for line in gzip.open(os.path.join(FP, f"book_{book}.txt.gz"), "rt"):
        f = line.rstrip("\n").split("|")
        side = lambda s: [(float(a), float(b), int(c) if c else None) for a, b, c in (x.split(":") for x in s.split(";") if x)]
        out.append((int(f[0]), side(f[2]), side(f[3])))
    return out


def book_seen(book):
    """{ms: seen_until ms}: the last minute the recorder read the same book (it stores a book only when it changed)."""
    out = {}
    for line in gzip.open(os.path.join(FP, f"book_{book}.txt.gz"), "rt"):
        f = line.split("|", 2)
        out[int(f[0])] = int(f[1])
    return out


def cb(book):
    out = []
    for line in gzip.open(os.path.join(FP, f"cb_{book}.txt.gz"), "rt"):
        f = line.rstrip("\n").split("|")
        out.append((int(f[0]), float(f[1]), float(f[2]), float(f[3] or 0), float(f[4] or 0)))
    return out


def bps(a, b):
    return 1e4 * math.log(a / b)


def day(ms):
    import datetime
    return datetime.datetime.utcfromtimestamp(ms / 1000).strftime("%Y-%m-%d")


def week(ms):
    import datetime
    d = datetime.datetime.utcfromtimestamp(ms / 1000)
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def median(xs):
    xs = sorted(xs)
    n = len(xs)
    if not n:
        return None
    return xs[n // 2] if n % 2 else 0.5 * (xs[n // 2 - 1] + xs[n // 2])


def q(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    return xs[min(len(xs) - 1, int(p * len(xs)))]
