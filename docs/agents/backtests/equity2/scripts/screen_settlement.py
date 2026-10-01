"""Does the month-end pattern move with the settlement cycle? A pre-2016 check of H1's premise.

US equities settled T+5 until June 1995 and T+3 from 1995-06-07 to 2017-09-04 (Etula et al. footnote 8). The
mechanism puts the selling deadline at T-(s+1): S_s = [T-(s+5), T-(s+1)], PB_s = [T-s, T+3].
For each regime (T+5: turns with T in 1975-01 .. 1995-05; T+3: T in 1995-07 .. 2015-11), the spread statistic
D = mean daily excess over PB - over S, computed with the regime's OWN windows and with the OTHER regime's windows.
If the mechanism holds, each regime's own windows give the larger D. Also the mean excess by day T-12 .. T+8.
CRSP VW market excess (Ken French daily), cut at 2015-12-31 on parse. The 1975 start is a choice made before
looking (T+5 was in force throughout 1975-1995 to this author's knowledge; the start of T+5 is not checked here).
Output: ../results/screen_settlement.json
"""
import json, math, os
import numpy as np
from common import read_block, month_turns, r

HERE = os.path.dirname(os.path.abspath(__file__))
d, c, m = read_block("F-F_Research_Data_Factors_daily", "Mkt-RF", True)
x = m[:, c.index("Mkt-RF")]
turns = month_turns(d)


def D(kT, s):
    pb = x[kT - s:kT + 4]
    sw = x[kT - (s + 5):kT - s]
    return pb.mean() - sw.mean()


OUT = {}
for lab, lo, hi, own in [("T+5_1975-01_1995-05", 197501, 199505, 5), ("T+3_1995-07_2015-11", 199507, 201511, 3)]:
    ks = [(k, ym) for k, ym in turns if lo <= ym <= hi]
    res = {"events": len(ks)}
    for s in (5, 3, 2, 1):
        v = np.array([D(k, s) for k, _ in ks])
        res[f"windows_T+{s}"] = {"mean_bps_per_day": r(1e4 * v.mean(), 2), "t": r(v.mean() / v.std(ddof=1) * math.sqrt(len(v)), 2)}
    prof = {}
    for j in range(-12, 9):
        v = np.array([x[k + j] for k, _ in ks])
        prof[j] = {"mean_bps": r(1e4 * v.mean(), 2), "t": r(v.mean() / v.std(ddof=1) * math.sqrt(len(v)), 2)}
    res["profile_T_minus12_to_plus8"] = prof
    fri = [D(k, own) for k, ym in ks if str(d[k]) and __import__("datetime").date(d[k] // 10000, d[k] // 100 % 100, d[k] % 100).weekday() == 4]
    oth = [D(k, own) for k, ym in ks if __import__("datetime").date(d[k] // 10000, d[k] // 100 % 100, d[k] % 100).weekday() != 4]
    res["own_windows_T_is_friday"] = {"n": len(fri), "mean_bps_per_day": r(1e4 * np.mean(fri), 2)}
    res["own_windows_T_not_friday"] = {"n": len(oth), "mean_bps_per_day": r(1e4 * np.mean(oth), 2)}
    OUT[lab] = res
json.dump(OUT, open(os.path.join(HERE, "..", "results", "screen_settlement.json"), "w"), indent=1, sort_keys=True)
for lab, res in OUT.items():
    print(lab, res["events"], {k: v for k, v in res.items() if k.startswith("windows")})
    print("   friday", res["own_windows_T_is_friday"], "other", res["own_windows_T_not_friday"])
    print("   profile", " ".join(f"{j}:{v['mean_bps']}" for j, v in res["profile_T_minus12_to_plus8"].items()))
