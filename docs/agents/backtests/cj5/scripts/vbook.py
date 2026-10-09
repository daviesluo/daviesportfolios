"""A venue's book for PR5's frozen simulator (`docs/agents/scripts/pr5/pr5_sim.py`), built from any print tape.

`pr5_sim.simulate(B, ...)` reads only these attributes of its book: `book`, `t0`, `n`, `X`, `F`, `by_min`, `qvol`,
`last_before`, `last_at_or_before`. `pr5_sim.Book` builds them from Revolut X's files; `VBook` builds the same fields,
the same way, from a list of prints, an FX map and an hourly USD series, so the frozen `simulate` and `exit_only` run on
CoinJar unchanged. `calibrate.py` proves the equivalence: on PR5's committed Revolut X inputs a VBook reproduces
pr5_run1.json's PRIMARY figure for figure.

Sizing in pounds. `simulate` sizes a fill as min(size, 10 % of the minute's GBP volume × lastX) dollars and converts
back at lastX, and books P&L as GBP × lastX. With `gbp=True` the book's X is 1.0 in every minute where interbank X
exists (None where it does not, so dark minutes stay dark), while F = fairU / X uses the real X. `size` is then pounds,
the 10 % cap is pounds, and every `pnl_usd` / `notional_usd` the simulator writes is pounds.
"""
import bisect, collections, os, statistics as st, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "../../../scripts/pr5")))
import pr5_sim as P  # noqa: E402  (the frozen simulator, imported read-only)

M = 60000


def fair_f3(hours_t, hours_c, t0, t1):
    """PR5's F3: for each minute t in [t0, t1), the median of the hourly closes whose hour started in [t-24 h, t-1 h]."""
    out, cache = {}, {}
    for t in range(t0, t1, M):
        i, j = bisect.bisect_left(hours_t, t - 1440 * M), bisect.bisect_right(hours_t, t - 60 * M)
        if (i, j) not in cache:
            cache[(i, j)] = st.median(hours_c[i:j]) if j > i else None
        out[t] = cache[(i, j)]
    return out


class VBook:
    def __init__(self, book, prints, t0, t1, fx_t, fx_v, hours_t, hours_c, gbp=True, tick=1e-4):
        """prints: [(ts_ms, ticks, qty, side)] sorted by time; fx_t/fx_v: sorted minute starts and GBP/USD;
        hours_t/hours_c: the USD book's hourly starts and closes."""
        self.book, self.t0, self.t1 = book, t0, t1
        self.n = (t1 - t0) // M
        self.all_prints = prints
        self.pts = [p[0] for p in prints]
        self.by_min = collections.defaultdict(list)
        for p in prints:
            if t0 <= p[0] < t1:
                self.by_min[(p[0] - t0) // M].append(p)
        self.qvol = {i: sum(q * pt * tick for ts, pt, q, s in ps) for i, ps in self.by_min.items()}
        fu = fair_f3(hours_t, hours_c, t0, t1)
        self.X = [None] * self.n
        self.F = [None] * self.n
        self.Xreal = [None] * self.n
        for i in range(self.n):
            t = t0 + i * M
            k = bisect.bisect_right(fx_t, t - M) - 1
            x = fx_v[k] if k >= 0 and fx_t[k] >= t - 10 * M else None
            self.Xreal[i] = x
            self.X[i] = (1.0 if x else None) if gbp else x
            u = fu.get(t)
            self.F[i] = (u / x) if (x and u) else None

    def last_before(self, t_ms):
        k = bisect.bisect_left(self.pts, t_ms) - 1
        if k < 0:
            return None
        return self.all_prints[k][1], self.all_prints[k][3]

    def last_at_or_before(self, t_ms):
        k = bisect.bisect_right(self.pts, t_ms) - 1
        return self.all_prints[k][1] if k >= 0 else None
