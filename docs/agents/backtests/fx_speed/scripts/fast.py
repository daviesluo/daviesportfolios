"""FX-SPEED: the X each candidate gives a paper minute t, from Exness's ticks (`exness.py`) and Yahoo's stored bars.

Every engine here prices minute t's quotes on X, and those quotes go live later: the PR5-OPT replay's executor rests them at
t + 90 s (its turn 30 s into the minute after the paper minute), PR5's frozen simulator (the Coinbase rows) and the OKX
engine at t + 60 s. Yahoo's X for minute t is its bar labelled t − 1, which matches Exness best 28 s into its minute
(`yahoo_timing.py`), so it is the price of about t − 32 s. A source read L seconds before the order goes live gives the price
of (go-live − L). The candidates, as instants relative to t:

    yahoo        the stored bar (today's X)
    ex_ytime     Exness at t − 32 s: Yahoo's own timing, another source (separates the source from the timing)
    L60, L30, L15, L5, L2   Exness at go-live − L
    L0           Exness at go-live: the bound, nothing faster exists for an order resting from then

`aligned` multiplies an Exness value by (1 + the median of Yahoo / Exness-at-Yahoo's-timing − 1 over the previous 1,440
minutes with both), so a candidate carries Yahoo's level (EUR/USD=X sits 2.8 bps over Exness, GBP/USD=X 0.33) and differs
from Yahoo only in timing. Everything is causal: an offset uses bars labelled before t − 1, and an Exness value is the last
tick at or before its instant.
"""
import bisect, collections, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import exness as E  # noqa: E402

M = 60_000
LS = (60, 30, 15, 5, 2, 0)
PRIMARY = "L2"


def instants(golive_s):
    """{name: seconds relative to t} for an engine whose orders go live golive_s after t."""
    d = {"ex_ytime": -32}
    for L in LS:
        d[f"L{L}"] = golive_s - L
    return d


class Fast:
    def __init__(self, yahoo):
        """`yahoo`: {pair: {bar label ms: value}}."""
        self.X = E.Offsets(os.path.join(HERE, "..", "data", "exness_offsets.txt.gz"))
        self.y = yahoo
        self.off = {p: self._offsets(p) for p in yahoo}

    def ex(self, pair, t, rel_s):
        at = t + rel_s * 1000
        m = at // M * M
        s = (at - m) // 1000
        return self.X.mid(pair, m, s)

    def _offsets(self, pair):
        """{label ms: median of the last 1,440 (Yahoo / Exness at the label + 28 s − 1) known before the label} (ratio)."""
        ys = sorted(self.y[pair].items())
        win, srt, out = collections.deque(), [], {}
        for lab, v in ys:
            out[lab] = srt[len(srt) // 2] if srt else None
            e = self.X.mid(pair, lab, 28)
            if e:
                r = v / e - 1
                win.append(r); bisect.insort(srt, r)
                if len(win) > 1440:
                    old = win.popleft(); del srt[bisect.bisect_left(srt, old)]
        self._labs = None
        return out

    def offset_at(self, pair, t):
        """The offset known at t: the one stored with the latest label at or before t − 1 min."""
        d = self.off[pair]
        if not hasattr(self, "_keys"):
            self._keys = {}
        if pair not in self._keys:
            self._keys[pair] = sorted(d)
        ks = self._keys[pair]
        k = bisect.bisect_right(ks, t - M) - 1
        return d[ks[k]] if k >= 0 else None

    def x(self, pair, t, rel_s, aligned):
        e = self.ex(pair, t, rel_s)
        if e is None or not aligned:
            return e
        o = self.offset_at(pair, t)
        return None if o is None else e * (1 + o)
