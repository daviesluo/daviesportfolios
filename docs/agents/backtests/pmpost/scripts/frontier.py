"""PMPOST: the far-from-the-touch frontier, by closed-form arithmetic on LP-BEST's calibrated engine.

Input: LP-BEST's universe table (docs/agents/backtests/lpbest/results/universe.txt, "By placement, all eligible
market-days", $ a day over 2026-10-05 -> 10-12, 4,815 market-days, stateless two-sided quotes of N a side, fills x k_vol
1.283, formula in the engine's units). For each placement: the formula and the 60- and 240-minute markout per filled
share, the R at which the rewards pay for the markout (R* = markout / formula per share), and the net a day at:
  - R 0.420, the engine's live R on S2 (LP-BEST section 1: live's payout over the engine's own formula);
  - Q2's live calibration (Q2-TRIPS section 2): rewards x 0.571 of R 0.420, and fills charged a further 0.918 c a share;
  - at the account's scale: about 10 markets of the ~602 eligible a day (4,815 / 8), so the universe's $ x 10 / 602.
Run: python3 -I scripts/frontier.py
"""
rows = [  # placement, formula $/day, rewards at 0.42, filled shares/day, mo60 $, mo240 $  (universe.txt, verbatim)
    ("a tick inside the touch (RW, S2)", 424.7, 178.4, 19092, -286.9, -408.0),
    ("at the touch", 267.4, 112.3, 9688, -235.9, -371.5),
    ("1 tick behind the touch", 147.8, 62.1, 3048, -79.1, -112.6),
    ("2 ticks behind", 83.3, 35.0, 1896, -55.1, -71.0),
    ("3 ticks behind", 55.0, 23.1, 1415, -35.1, -38.8),
]
R_S2, Q2_REW, Q2_FILL_C = 0.420, 0.571, 0.918
SCALE = 10 / (4815 / 8)
print("placement                          formula c/sh  mo60 c/sh  R*60  R*240 | net60 $/d universe: R .42 | Q2-calib | at 10 markets: R .42 | Q2-calib")
for name, f, rw, sh, m60, m240 in rows:
    fcs, m60c, m240c = 100 * f / sh, 100 * m60 / sh, 100 * m240 / sh
    rs60, rs240 = -m60 / f, -m240 / f
    net = rw + m60
    netq = rw * Q2_REW + m60 - Q2_FILL_C / 100 * sh
    print(f"{name:34s} {fcs:8.2f}   {m60c:8.2f}   {rs60:5.2f} {rs240:5.2f} | {net:8.1f}  {netq:8.1f} | {net * SCALE:+7.2f}  {netq * SCALE:+7.2f}")
print()
print("R* is in the engine's units, where live S2 was paid 0.42 (0.61 with no friction of the live path) and Q2 about")
print("0.42 x 0.571 = 0.24. Every placement needs at least 0.54 at 60 minutes and 0.71 at 240, before the live fill charge.")
for name, f, rw, sh, m60, m240 in rows:
    extra = Q2_FILL_C / 100 * sh
    print(f"  {name:34s} R* with Q2's fill charge: 60 min {(-m60 + extra) / f:.2f}, 240 min {(-m240 + extra) / f:.2f}")
print()
print("The upside with no friction at all (R 0.61, LP-BEST's paid over the two-sided formula), 60-minute markout:")
for name, f, rw, sh, m60, m240 in rows:
    up = 0.61 * f + m60
    print(f"  {name:34s} universe {up:+7.1f} $/d, at 10 markets {up * SCALE:+.2f} $/d")
