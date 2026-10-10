"""Minute bars that PR5's frozen simulator reads exactly as it reads the prints they come from.

`pr5_sim.simulate` and `exit_only` read a minute's prints only through (a) "is any print strictly through (or at) this
price", with or without the aggressor's side (`through`, the `side_aware` arm), (b) the minute's GBP volume `qvol`, and (c)
the last print before an instant (`last_before`, `last_at_or_before`), which they ask only at minute boundaries. A rung
filled in a minute leaves the market until the next turn, so the order of prints inside a minute changes nothing. A bar
therefore keeps, per minute: the lowest and highest price each aggressor side printed, the minute's last print (time,
price, aggressor), its quote volume and its print count. `BarBook` turns a bar back into at most five prints (the four
extremes, then the true last print at its own time) and gives the simulator the same fields `VBook` gives it.
`check_equivalence` proves it: CJ5's CoinJar prints, reduced to bars, give equal trips (as sorted lists; the fill's print time aside) in every arm but `side_aware`, where CoinJar's auction prints,
which no other venue has, count with the buys (calibrate_bars.py).

Bar layout (the pullers'): [sell_min, sell_max, buy_min, buy_max, last_ms, last_pe8, last_side, last_tid, vol_quote, n],
prices in 1e-8 of the quote currency.
"""
import bisect, collections, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "../../cj5/scripts")))
from vbook import VBook, fair_f3, P, M  # noqa: E402  (CJ5's adaptor and, through it, PR5's frozen simulator)


def merge(a, b):
    """Two bars of the same minute (from two pull segments) into one."""
    out = list(a)
    for j, f in ((0, min), (1, max), (2, min), (3, max)):
        xs = [x for x in (a[j], b[j]) if x is not None]
        out[j] = f(xs) if xs else None
    if (b[7], b[4]) > (a[7], a[4]):
        out[4:8] = b[4:8]
    out[8], out[9] = a[8] + b[8], a[9] + b[9]
    return out


def bars_from_prints(prints_full):
    """CJ5's full prints [(tid, t_us, ticks, qty, value, side)] -> bars keyed by minute index (ms // M), as the pullers write."""
    bars = {}
    for tid, t_us, tk, q, val, side in prints_full:
        t = t_us // 1000
        pe8 = round(tk * 1e4)                      # CoinJar ticks are 1e-4 pounds; 1e-8 units
        k = t // M
        b = bars.get(k)
        if b is None:
            b = bars[k] = [None, None, None, None, -1, None, None, -1, 0.0, 0]
        j = 0 if side == "sell" else 2            # CoinJar's auction prints count with the buys, as either side can be hit
        b[j] = pe8 if b[j] is None else min(b[j], pe8)
        b[j + 1] = pe8 if b[j + 1] is None else max(b[j + 1], pe8)
        if (t, tid) >= (b[4], b[7]):
            b[4], b[5], b[6], b[7] = t, pe8, side, tid
        b[8] += q * tk * 1e-4
        b[9] += 1
    return bars


def prints_from_bars(bars, tick):
    """bars {minute: bar} -> [(ts_ms, ticks, qty, side)] in time order; qty carries no meaning (BarBook sets qvol itself)."""
    out = []
    for k in sorted(bars):
        b = bars[k]
        lt = b[4]
        for j, side in ((0, "sell"), (2, "buy"), (1, "sell"), (3, "buy")):
            if b[j] is not None:
                out.append((lt, _tk(b[j], tick), 0.0, side))
        out.append((lt, _tk(b[5], tick), 0.0, b[6]))
    return out


def _tk(pe8, tick):
    u = round(tick * 1e8)
    return pe8 // u if pe8 % u == 0 else pe8 / u


class BarBook(VBook):
    def __init__(self, book, bars, t0, t1, fx_t, fx_v, hours_t, hours_c, tick, gbp=True):
        super().__init__(book, prints_from_bars(bars, tick), t0, t1, fx_t, fx_v, hours_t, hours_c, gbp=gbp, tick=tick)
        self.tick = tick
        self.qvol = {i: 0.0 for i in self.by_min}
        for k, b in bars.items():
            t = int(k) * M
            if t0 <= t < t1:
                self.qvol[(t - t0) // M] = b[8]
        self.prints_n = sum(b[9] for k, b in bars.items() if t0 <= int(k) * M < t1)


def committed_encoding(bars):
    """What sv_inputs.py commits: the last print at its minute's first ms, the quote volume to 0.01."""
    return {k: b[:4] + [int(k) * M, b[5], b[6], -1, round(b[8] * 1e2) / 1e2, 0] for k, b in bars.items()}


def check_equivalence(prints_full, book, t0, t1, fx_t, fx_v, hours_t, hours_c, sizes=(100.0,), arms=("through",), encode=False):
    """VBook on the prints against BarBook on their bars: every arm's trips must be equal (with `encode`, the committed
    encoding: equal up to the volume rounding's effect on the 10 % cap)."""
    pr = [(t_us // 1000, tk, q, s) for _, t_us, tk, q, _, s in prints_full]
    vb = VBook(book, pr, t0, t1, fx_t, fx_v, hours_t, hours_c, gbp=True)
    bars = bars_from_prints(prints_full)
    if encode:
        bars = committed_encoding(bars)
    bb = BarBook(book, bars, t0, t1, fx_t, fx_v, hours_t, hours_c, 1e-4)
    res = {}
    for size in sizes:
        for arm in arms:
            kw = {"stress": arm == "stress", "side_aware": arm == "side_aware", "full": arm == "full_size"}
            a, _ = P.simulate(vb, size=size, **kw)
            b, _ = P.simulate(bb, size=size, **kw)
            # trips closed in the same minute are appended in print order, which a bar does not keep: compare as sorted lists
            strip = lambda tr: sorted((tuple(sorted((k, v) for k, v in x.items() if k != "fill_ts")) for x in tr))
            res[f"{arm}_{int(size)}"] = {"trips": len(a), "equal": strip(a) == strip(b), "pnl": round(sum(x["pnl_usd"] for x in a), 6),
                                         "pnl_bars": round(sum(x["pnl_usd"] for x in b), 6)}
    return res
