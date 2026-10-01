"""DFC robustness on the screen (pre-2016 only): D (H2 windows) and the dodge rule's net at 8 bps, by sub-period,
without 2008-2009, and the share of the dodge's 1990-2015 total from its best month. CRSP VW. Output:
../results/screen_dfc_robust.json"""
import json, math, os
import numpy as np
from common import read_block, month_turns, r
HERE = os.path.dirname(os.path.abspath(__file__))
d, c, m = read_block("F-F_Research_Data_Factors_daily", "Mkt-RF", True)
x = m[:, c.index("Mkt-RF")]
ev = {}
for kT, ym in month_turns(d):
    if kT - 8 >= 0 and kT + 3 < len(x):
        s = x[kT - 8:kT - 3].sum(); pb = x[kT - 3:kT + 4].sum()
        ev[ym] = (pb / 7 - s / 5, -s - 0.0008)
OUT = {}
def blk(keys):
    D = np.array([ev[k][0] for k in keys]); g = np.array([ev[k][1] for k in keys])
    return {"n": len(keys), "D_bps_day": r(1e4 * D.mean(), 2), "D_t": r(D.mean() / D.std(ddof=1) * math.sqrt(len(D)), 2),
            "dodge_net8_ann_pct": r(1200 * g.mean(), 2), "dodge_t": r(g.mean() / g.std(ddof=1) * math.sqrt(len(g)), 2)}
for lab, a, b in [("1990-1999", 199001, 199912), ("2000-2007", 200001, 200712), ("2008-2009", 200801, 200912),
                  ("2010-2015", 201001, 201512), ("1990-2015", 199001, 201512)]:
    OUT[lab] = blk([k for k in ev if a <= k <= b])
OUT["1990-2015_without_2008_2009"] = blk([k for k in ev if 199001 <= k <= 201512 and not 200801 <= k <= 200912])
ks = [k for k in ev if 199001 <= k <= 201512]
tot = sum(ev[k][1] for k in ks); best = max(ks, key=lambda k: ev[k][1])
OUT["dodge_1990_2015_best_month"] = {"month": best, "share_of_total": r(ev[best][1] / tot), "total_pct": r(100 * tot, 2)}
json.dump(OUT, open(os.path.join(HERE, "..", "results", "screen_dfc_robust.json"), "w"), indent=1, sort_keys=True)
for k, v in OUT.items(): print(k, v)
