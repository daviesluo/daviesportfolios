"""LP-RULES: every earlier study's arm, re-priced at the live R, by closed-form arithmetic.

An arm's difference from the rule as run is linear in R: delta(R) = dFills + R * dFormula. Each study below published
the difference at two R (or three); that fixes dFormula and dFills, the break-even R* = -dFills / dFormula, and the
difference at any other R. Units: each study's own formula, so R must be put in them too.
  - LP-ALLOC / LP-REFILL's simulator: live R 0.807 (10-09, like for like) is 0.481 there (LP-ALLOC, "What R means
    here"); the live pooled 0.737 [0.696, 0.813] (scripts/r_bootstrap.py) is 0.439 [0.415, 0.485].
  - RW's paper record (Phase A, RWC-OPT, LPSELF): its formula priced every minute at the 00:00 programme, which
    Polymarket cut through the day; LP-ALLOC measured the cut at 64 % of the formula on today's rule ($84.9 -> $30.6 a
    day), so the live 0.737 is about 0.737 * 0.36 = 0.27 there, and at most 0.74 if no cut applied. Both are shown.
Figures are the studies' own, per their record's length, and are turned into $ a day by that length.
Run: python3 -I scripts/reprice.py
"""
arms = [
    # study, record days, arm, (R1, delta1), (R2, delta2)  -- deltas against the rule as run, $ over the record
    ("Phase A (RW, 9.6 d)", 9.6, "buy-only orders", (1.0, -643), (0.40, -179)),
    ("Phase A (RW, 9.6 d)", 9.6, "the path's loss stops (-$25 day / -$75)", (1.0, -750), (0.40, -282)),
    ("Phase A (RW, 9.6 d)", 9.6, "hold carried (no close-only exits)", (1.0, -407), (0.40, -132)),
    ("Phase A (RW, 9.6 d)", 9.6, "3N side cap", (1.0, -102), (0.40, -54)),
    ("Phase A (RW, 9.6 d)", 9.6, "no 15c pause", (1.0, -50), (0.40, -51)),
    ("Phase A (RW, 9.6 d)", 9.6, "48-hour end horizon", (1.0, -88), (0.40, -33)),
    ("Phase A (RW, 9.6 d)", 9.6, "8 markets / $160", (1.0, -28), (0.40, -18)),
    ("Phase A (RW, 9.6 d)", 9.6, "$60 a market", (1.0, -22), (0.40, -13)),
    ("Phase A (RW, 9.6 d)", 9.6, "keep same-day markets", (1.0, 123), (0.40, -83)),
    ("Phase A (RW, 9.6 d)", 9.6, "keep weather markets", (1.0, 16), (0.40, -15)),
    ("Phase A (RW, 9.6 d)", 9.6, "7N side cap (on S1)", (1.0, 9), (0.40, 3)),
    ("Phase A (RW, 9.6 d)", 9.6, "no side cap (on S1)", (1.0, -12), (0.40, -20)),
    ("Phase A (RW, 9.6 d)", 9.6, "band >= $50 (on S1)", (1.0, -46), (0.40, -16)),
    ("Phase A (RW, 9.6 d)", 9.6, "$400 cap, 12 markets (on S1)", (1.0, 26), (0.40, 5)),
    ("Phase A (RW, 9.6 d)", 9.6, "taker exits at 00:05 (on S1)", (1.0, -11), (0.40, -13)),
    ("RWC-OPT (RW, 14 d, strict)", 14, "remove TB1's skip", (1.0, 22.51), (0.40, -68.85)),
    ("LPSELF (RW, 14 d)", 14, "skip at two ticks (at-price 0.40 / R 1)", (1.0, -95.85), (0.40, 21.81)),
    ("LPSELF (full univ., 4 d, strict)", 4, "remove TB1's skip", (1.0, 7.44), (0.40, -17.87)),
    ("LPSELF (full univ., 4 d)", 4, "re-select every 6 h", (1.0, -48.74), (0.40, 57.06)),
    ("LP-ALLOC (sim, 5 d)", 1, "keep AI markets ($/day)", (0.58, -2.88), (0.23, -6.29)),
    ("LP-REFILL (sim, 5 d)", 1, "no refill vs the 00:00 reserve ($/day)", (0.47, -5.10), (0.23, -3.76)),
    ("LP-REFILL (sim, 5 d)", 1, "A13's live re-rank vs the 00:00 reserve ($/day)", (0.47, 1.27), (0.23, 2.40)),
]
def line(study, days, name, a, b):
    (r1, d1), (r2, d2) = a, b
    df = (d1 - d2) / (r1 - r2); dfi = d1 - r1 * df
    rstar = -dfi / df if df else float("inf")
    sim = "sim" in study
    pts = (0.415, 0.439, 0.485) if sim else (0.27, 0.40, 0.74)
    at = [round((dfi + r * df) / days, 2) for r in pts]
    return f"{study:34s} {name:46s} dFormula {df/days:8.2f}/d  dFills {dfi/days:8.2f}/d  R* {rstar:6.2f}   at R {pts}: {at} $/d"
print("Each arm against the rule as run (a change; + = the change earns more). $ a day.")
print("Sim units: live R 0.737 = 0.439 [0.415, 0.485]. RW units: 0.27 (programme cut 64 %), 0.40 (the studies' choice), 0.74 (no cut).")
for a in arms: print(line(*a))
