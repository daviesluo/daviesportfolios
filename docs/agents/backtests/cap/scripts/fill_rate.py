# Entries so far against the backtests' rate (testingset.json s2_rows, shipped stop, windows A-D; the live row's one-slot
# rate from cap_study.json). Poisson tail P(X >= observed); entries cluster across coins, so these tails are too small
# (inference), and are a size check only.
from scipy.stats import poisson
rows = {  # (entries observed, days running, fills per 90 days low, high)
  "trend-4h (paper, 5 coins)": (4, 10.25, 14.55, 26.81),
  "trend-1h (paper)": (5, 10.25, 31.65, 56.07),
  "momentum-1d (paper; 4h-cadence pricing)": (3, 10.25, 17.81, 29.04),
  "trend-4h-live (one slot, CAP study A/B)": (1, 6.07, 9.82, 13.06),
}
for k, (obs, days, lo, hi) in rows.items():
    lam_lo, lam_hi = lo / 2 / 90 * days, hi / 2 / 90 * days
    print(f"{k:42} entries {obs}  expected {lam_lo:.2f}-{lam_hi:.2f}  P(X>={obs}) {poisson.sf(obs-1, lam_hi):.3f}-{poisson.sf(obs-1, lam_lo):.3f}")
# EX-GAP: days from 2026-10-01 to 16 pairs (14 more), if every live fill pairs (inference)
for label, lo, hi in [("one slot", 9.82, 13.06), ("four slots", 18.45, 26.13)]:
    print(f"EX-GAP 14 more pairs at {label}: {14/(hi/90):.0f}-{14/(lo/90):.0f} days")
