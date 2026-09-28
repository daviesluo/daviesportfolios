# Does cstar.py's event code give the first measurement's numbers on the first measurement's own span?
# chase.py: every hour close with all 61 minutes present, 2026-07-01 00:00 -> before 2026-09-28 00:00, T = 60, s = 2 bps.
# Miss counts, miss rates, means, medians and p90s must be identical; the bootstrap bounds differ only because
# chase.py draws every cell from ONE random.Random(1) in sequence and cstar.py seeds each cell afresh.
import statistics as st
from cstar import Tape, boot_upper

for sym in ("BTCUSDT", "ETHUSDT", "SOLUSDT"):
    t = Tape(sym)
    for side in ("buy", "sell"):
        ev = [t.event(x, side, 60) for x in range(1782864000000, 1790553600000, 3600000)]
        n = sum(1 for s, _ in ev if s != "nodata")
        c = [v for s, v in ev if s == "miss"]
        print(f"{sym} {side}: hours {n}, misses {len(c)} ({100 * len(c) / n:.1f} %), mean chase {st.mean(c):.1f} bps, "
              f"median {st.median(c):.1f}, 97.5% upper of mean (fresh seed) {boot_upper(c):.1f}, p90 {sorted(c)[int(0.9 * len(c))]:.1f}")
