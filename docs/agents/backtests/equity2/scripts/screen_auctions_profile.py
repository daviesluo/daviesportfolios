"""Per-day profile of the 10- and 30-year yield around auctions, 1990-2015 and 2003-2015 (pre-2016 only), and the
window a London-listed ETF could actually hold: in at the close of t+1 (the first LSE session after a 13:00 ET
auction ends 11:30 ET on t+1; the close of t+1 is the conservative proxy), out at the close of t+5.
Output: ../results/screen_auctions_profile.json"""
import json, math, os
import numpy as np
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "screen_auctions.py")).read().split("OUT = {}")[0])
OUT = {}
for k in ("10", "30"):
    y = np.array([curve[d][k] if curve[d][k] is not None else np.nan for d in days])
    dy = np.r_[np.nan, np.diff(y)] * 100
    mu = np.nanmean(dy)
    for lab, lo, hi in (("1990-2015", 1990, 2015), ("2003-2015", 2003, 2015)):
        ii = [i for i in sorted(set(ev[k])) if lo <= days[i].year <= hi and i - 7 >= 0 and i + 8 < len(y)]
        prof = {j: round(float(np.nanmean([dy[i + j] for i in ii]) - mu), 3) for j in range(-6, 9)}
        tr = np.array([y[i + 5] - y[i + 1] for i in ii]) * 100
        tr = tr[~np.isnan(tr)] - 4 * mu
        OUT[f"{k}y_{lab}"] = {"n": len(ii), "abn_bp_by_day_t-6..t+8": prof,
                             "tradable_t+1_to_t+5_abn_bp": round(float(tr.mean()), 3),
                             "tradable_t": round(float(tr.mean() / tr.std(ddof=1) * math.sqrt(len(tr))), 2),
                             "tradable_sd_bp": round(float(tr.std(ddof=1)), 3),
                             "tradable_price_pct_dur17": round(float(-17 * tr.mean() / 100), 3)}
json.dump(OUT, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results", "screen_auctions_profile.json"), "w"), indent=1, sort_keys=True)
for k, v in OUT.items():
    print(k, v["n"], "tradable", v["tradable_t+1_to_t+5_abn_bp"], "t", v["tradable_t"], "sd", v["tradable_sd_bp"], "price%", v["tradable_price_pct_dur17"])
    print("   ", " ".join(f"{j}:{x}" for j, x in v["abn_bp_by_day_t-6..t+8"].items()))
