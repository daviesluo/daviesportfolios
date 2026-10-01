"""Years a FORWARD paper test needs for 80 % power at one-sided 5 % (z 1.645 + 0.842), per candidate, at the
pre-2016 screen's effect. Inputs are read from the screen results; HMM's figure is the paper's abstract (17 bp a
day after a month end, one event a month) against a 1.1 % daily sd (ASSUMPTION). Output: ../results/power_forward.json"""
import json, os
from scipy.stats import norm
HERE = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(HERE, "..", "results")
Z = norm.ppf(0.95) + norm.ppf(0.80)
pc = json.load(open(os.path.join(R, "power_calendar.json")))
au = json.load(open(os.path.join(R, "screen_auctions_profile.json")))
xs = json.load(open(os.path.join(R, "screen_xs.json")))
out = {}
for lab in ("1990-2015", "2003-2015"):
    s = pc["US_CRSP_VW"][lab]["D_SPREAD"]
    out[f"DFC_pattern_{lab}"] = round((Z * s["sd_bps_per_day"] / s["mean_bps_per_day"]) ** 2 / 12, 1)
    a = au[f"30y_{lab}"]
    out[f"TAC_tradable_30y_{lab}"] = round((Z * a["tradable_sd_bp"] / abs(a["tradable_t+1_to_t+5_abn_bp"])) ** 2 / 12, 1)
    ir = xs["industry_seasonality_top5_of_49"][lab]["active_vs_ew"]["ir"]
    out[f"IS49_gross_{lab}"] = round((Z / ir) ** 2, 1)
out["HMM_rebalancing_month_end"] = round((Z * 1.1 / 0.17) ** 2 / 12, 1)
json.dump(out, open(os.path.join(R, "power_forward.json"), "w"), indent=1, sort_keys=True)
print(json.dumps(out, indent=1))
