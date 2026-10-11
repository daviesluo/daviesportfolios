"""LP-CAPDEEP: the earlier capital estimates re-priced at the live R, and the live replay since Addendum 17 put in $.

Reads LP-REFILL's committed per-day records (../lp_refill/results/raw/final2_atprice.json: at-price fills, $300 and $400
caps, each day's fills P&L and formula reward at R = 1) and prints, for each capital pair, the day-by-day difference
Delta = dFills + R * dFormula at the live R in simulator units (LP-RULES: live 0.737 = 0.439, band 0.415-0.485), with a
paired day bootstrap. Then LP-CAPINV's published rows and this study's live replay (results/alloc_extra.txt,
results/realisation.txt) at the live R 0.737 and the band [0.70, 0.81]. No database; run from this folder:

    python3 -I scripts/capital_reprice.py > results/capital_reprice.txt
"""
import json
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
RAW = HERE.parent / "lp_refill" / "results" / "raw" / "final2_atprice.json"
DAYS = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]
R_LIVE, R_BAND = 0.737, (0.70, 0.81)
R_SIM, R_SIM_BAND = 0.439, (0.415, 0.485)   # LP-RULES results/reprice.txt


def daily(arm):
    rows = {r["day"]: r for r in arm["daily"]}
    return {d: (rows[d]["tot"] - rows[d]["rew"], rows[d]["rew"], rows[d]["heldClose"], rows[d]["comMean"]) for d in rows}


def boot(xs, n=4000, seed=20261011):
    rnd = random.Random(seed)
    m = sorted(sum(rnd.choice(xs) for _ in xs) / len(xs) for _ in range(n))
    return m[int(0.05 * n)], m[int(0.95 * n)]


data = json.loads(RAW.read_text())
pairs = [
    ("refill (reserve00, 0 min, 10 a day) + $10 guard: $400 against $300",
     "C400 | reserve00 off0 max10 | marketLoss $10", "C300 | reserve00 off0 max10 | marketLoss $10"),
    ("refill, no guard: $400 against $300",
     "C400 | reserve00 off0 max10 | guards none", "C300 | reserve00 off0 max10 | guards none"),
    ("no refill + $10 guard: $400 against $300",
     "C400 | no refill | marketLoss $10", "C300 | no refill | marketLoss $10"),
]
print("== LP-REFILL's capital pairs, re-priced (simulator units; live R 0.737 = 0.439 [0.415, 0.485])")
for label, hi, lo in pairs:
    a, b = daily(data[hi]), daily(data[lo])
    df = [a[d][0] - b[d][0] for d in DAYS]
    dr = [a[d][1] - b[d][1] for d in DAYS]
    dh = [a[d][2] - b[d][2] for d in DAYS]
    dc = [a[d][3] - b[d][3] for d in DAYS]
    print(f"\n{label}")
    print("  day          dFills  dFormula  held at close  mean capital used  net at R 0.439")
    for i, d in enumerate(DAYS):
        print(f"  {d}  {df[i]:8.2f}  {dr[i]:8.2f}  {dh[i]:+12.1f}  {dc[i]:+17.1f}  {df[i] + R_SIM * dr[i]:+10.2f}")
    if "2026-10-10" in a and "2026-10-10" in b:
        d = "2026-10-10"
        print(f"  {d}* {a[d][0] - b[d][0]:8.2f}  {a[d][1] - b[d][1]:8.2f}  {a[d][2] - b[d][2]:+12.1f}  {a[d][3] - b[d][3]:+17.1f}"
              f"  {a[d][0] - b[d][0] + R_SIM * (a[d][1] - b[d][1]):+10.2f}   (* partial day, to 12:59 UTC; not in the means)")
    mf, mr = sum(df) / 5, sum(dr) / 5
    for r in (R_SIM_BAND[0], R_SIM, R_SIM_BAND[1], 0.47):
        net = [df[i] + r * dr[i] for i in range(5)]
        lo5, hi95 = boot(net)
        print(f"  R {r:.3f}: {sum(net) / 5:+.2f} a day for +$100 [{lo5:+.2f}, {hi95:+.2f}], ahead {sum(x > 1e-9 for x in net)}/5;"
              f" for +$80 (linear) {0.8 * sum(net) / 5:+.2f} [{0.8 * lo5:+.2f}, {0.8 * hi95:+.2f}]")
    print(f"  mean dFills {mf:+.2f}, dFormula {mr:+.2f}; break-even R (sim units) {(-mf / mr) if mr else float('nan'):.2f}")

print("\n== LP-CAPINV's rows (paid $ a day at R 0.807, rewards only, fills and holdings as recorded), at the live R")
for label, v in [("(c2)/(d) +$80, slot order, against (a)", 11.1), ("(c2)/(d) +$80 with rank order, against (f) rank order alone", 26.1 - 17.7),
                 ("(f) rank order against (a) (Addendum 17, deployed)", 3.9)]:
    print(f"  {label}: {v:+.2f} at 0.807 -> {v * R_LIVE / 0.807:+.2f} at {R_LIVE} [{v * R_BAND[0] / 0.807:+.2f}, {v * R_BAND[1] / 0.807:+.2f}]")

print("\n== this study's live replay since Addendum 17 (results/alloc_extra.txt, 00:51-01:27 UTC 10-11, 37 minutes)")
w_all, minutes = 6.759, 37
funded = {"e0": 4.417, "e20": 5.252, "e40": 5.784, "e60": 6.359, "e80": 6.725, "top5": 4.687, "held_lt_150": 4.417, "held_lt_200": 4.417}
k_two = {"10-10 ranks 4+ (2,638 two-sided minutes)": 0.208, "10-11 ranks 4-10 (53 two-sided minutes)": 0.091}
print("  selection formula a minute funded two-sided (share of the quoting weight); the gain over e0 as selection formula a day")
for v, w in funded.items():
    gain_day = (w - funded["e0"]) / minutes * 1440
    cells = "; ".join(f"k {k:.3f}: ${gain_day * k * R_LIVE:5.2f} [{gain_day * k * R_BAND[0]:5.2f}, {gain_day * k * R_BAND[1]:5.2f}]" for k in k_two.values())
    print(f"  {v:12s} {w:6.3f} ({w / w_all:5.1%})  +{gain_day:6.1f}/day  paid if the state held all day, rewards only: {cells}")
print("  k is the formula a two-sided minute scored over the selection's formula for that minute (results/realisation.txt):")
for k, v in k_two.items():
    print(f"    {k}: {v}")
print("  10-10's whole day (LP-CAPINV alloc_replay at +$80, rank order): +6.66 selection formula -> "
      f"${6.66 * 0.208 * R_LIVE:.2f} a day at k 0.208")
