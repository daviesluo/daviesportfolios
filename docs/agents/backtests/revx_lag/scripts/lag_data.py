"""REVX-LAG's inputs, one place: Revolut X UK's prints, the fair LIVE's engine priced each minute on, GBP/USD, and Coinbase's
GBP books, all as of a minute and all keyless and already committed (or derived from committed archives).

  prints   Revolut X UK, every public print: the nine-month tape (`inputs/pr5_2026-09-23`, from 2025-10-01 to 2026-09-23) and
           the recorded prints of 2026-09-26 → 10-29 (REVX-FAIR's `fair_price/data`).
  fair     PR5's minute record as the PR5-OPT engine reads it: fairU (the USD book's 24 h median of hourly closes) over X
           (the tape's Exness minute close; Yahoo's stored bar on the recorded window). `fair(b, t)` is the fair of paper
           minute t.
  X        Exness GBPUSD at each minute's start (FX-SPEED-RX's derived file, `RX_EX`), for the FX-move signals.
  Coinbase the last print of each minute of Coinbase's USDC-GBP and USDT-GBP (SCQ-VENUES' bars, 2024-10 → 2026-10-08), then
           the recorder's touch mid (2026-10-10 →, REVX-FAIR's `cb_*.txt`).

Every series is read "as of" an instant: only what was stamped before it.
"""
import bisect, collections, datetime, gzip, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(BT, "fair_price", "scripts"))
sys.path.insert(0, os.path.join(BT, "pr5_opt", "scripts"))
sys.path.insert(0, os.path.join(BT, "fx_speed", "scripts"))
sys.path.insert(0, os.path.join(BT, "scq_venues", "scripts"))
import fp_data as D  # noqa: E402
import sim  # noqa: E402

M, H, DAY = 60_000, 3_600_000, 86_400_000
TICK = 1e-4
BOOKS = ("USDC-GBP", "USDT-GBP")


def ms(*a):
    return int(datetime.datetime(*a, tzinfo=datetime.timezone.utc).timestamp() * 1000)


HIST = (ms(2025, 11, 26), ms(2026, 9, 23))
FWD = (ms(2026, 9, 26), ms(2026, 10, 29))
START = {"USDC-GBP": ms(2025, 11, 26), "USDT-GBP": ms(2025, 12, 16)}
SPLIT = ms(2026, 5, 12)          # in sample before, out of sample from (fixed before any run, as FX-SPEED-RX)


def day(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")


class Series:
    """(t, v) sorted; `at(t)` the newest value stamped strictly before t, at most `fresh` old."""

    def __init__(self, pts, fresh):
        pts = sorted(pts)
        self.t = [p[0] for p in pts]; self.v = [p[1] for p in pts]; self.fresh = fresh

    def at(self, t):
        i = bisect.bisect_left(self.t, t) - 1
        return self.v[i] if i >= 0 and t - self.t[i] <= self.fresh else None


def load_engine_inputs():
    """The PR5-OPT engine's own inputs: (history minutes, history prints, recorded minutes, recorded prints)."""
    hm, hp = sim.load_hist(*HIST)
    fm_raw = D.load_minutes(); fp = D.load_prints()
    fm = {b: [(t, x, fu) for (t, x, fu, lag) in v if FWD[0] - 2 * DAY <= t < FWD[1]] for b, v in fm_raw.items()}
    return hm, hp, fm, fp


def rx_prints(hp, fp):
    """{book: [(ms, price, qty, aggressor)]}, the tape and the recorded window, deduplicated, sorted."""
    out = {}
    for b in BOOKS:
        seen, rows = set(), []
        for src in (hp, fp):
            for p in src.get(b, []):
                k = (p[0], p[1])
                if k in seen: continue
                seen.add(k); rows.append((p[0], p[1] * TICK, p[2], p[3]))
        out[b] = sorted(rows)
    return out


def fair_table(hm, fm):
    """{book: {t: (fair, x, fu)}} from both minute records (the recorded window's wins where both have a minute)."""
    out = {}
    for b in BOOKS:
        d = {}
        for src in (hm, fm):
            for t, x, fu in src.get(b, []):
                if x and fu: d[t] = (fu / x, x, fu)
        out[b] = d
    return out


def exness_x(path):
    """Series of Exness GBPUSD at minute starts (offset 0 of FX-SPEED-RX's file)."""
    import revx_long_ex as RX
    E = RX.RxEx(path)
    return Series([(t, v[0]) for t, v in E.v.items() if v[0]], 10 * M), E


def coinbase(book):
    """Series of Coinbase's price of the coin in pounds: the minute's last print (stamped at the minute's end) to 10-08,
    then the recorder's touch mid (stamped when read)."""
    import sv_inputs as SI
    bars, _ = SI.load_bars("coinbase:" + book)
    pts = [(m * M + M - 1, v[5] / 1e8) for m, v in bars.items() if v[5]]
    cb = D.CbSeries(book) if os.path.exists(os.path.join(BT, "fair_price", "data", f"cb_{book}.txt.gz")) else None
    if cb:
        pts += list(zip(cb.t, cb.mid))
    return Series(pts, 30 * M)
