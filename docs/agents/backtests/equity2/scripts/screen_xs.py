"""Cross-sectional long-only screens on Ken French files, cut at 2015-12-31.

1. Big-cap short-term reversal, DAILY-formed (6_Portfolios_ME_Prior_1_0_daily:
   formed every day on the -20..-1 return; BIG LoPRIOR minus the big-cap
   average at 30/40/30 weights, as EQ1 used for the monthly file).
2. Low volatility: Portfolios_Formed_on_VAR, value-weighted Lo 20 (60-day total
   variance) against the CRSP VW market, monthly.
3. Industry seasonality (Heston & Sadka 2008, applied to industries): each
   month t, rank industries by their mean return in the same calendar month
   over years t-1 .. t-20; hold the top K equal-weighted for month t; active
   return against the equal-weighted average of all industries. 12 industries
   (K = 3) and 49 industries (K = 5). Turnover is measured from the holdings.
Output: ../results/screen_xs.json
"""
import json, math, os
import numpy as np
from common import read_block, ann, tstat, r

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = {"screen_end": "2015-12-31"}
PER_M = [("1927-1989", 192701, 198912), ("1990-2015", 199001, 201512), ("2003-2015", 200301, 201512)]

# ---- 1. daily-formed big-cap reversal
d, c, m = read_block("6_Portfolios_ME_Prior_1_0_daily", "BIG LoPRIOR", True,
                     block_title="Average Value Weighted Returns -- Daily")
lo, mid, hi = m[:, c.index("BIG LoPRIOR")], m[:, c.index("ME2 PRIOR2")], m[:, c.index("BIG HiPRIOR")]
act = lo - (0.3 * lo + 0.4 * mid + 0.3 * hi)
OUT["strev_daily_formed_big"] = {}
for lab, a, b in [("1927-1989", 19270101, 19891231), ("1990-2015", 19900101, 20151231), ("2003-2015", 20030101, 20151231)]:
    s = (d >= a) & (d <= b)
    OUT["strev_daily_formed_big"][lab] = {"long_only_active_vs_big_avg": ann(act[s], 252),
                                          "long_short_lo_minus_hi": ann((lo - hi)[s], 252)}

# ---- 2. low volatility (monthly)
dv, cv, mv = read_block("Portfolios_Formed_on_VAR", "Lo 20", False, block_title="Value Weighted Returns -- Monthly")
dm, cm, mm = read_block("F-F_Research_Data_Factors", "Mkt-RF", False)
mk = dict(zip(dm, mm[:, cm.index("Mkt-RF")] + mm[:, cm.index("RF")]))
rf = dict(zip(dm, mm[:, cm.index("RF")]))
low = mv[:, cv.index("Lo 20")]
OUT["low_var_quintile_vw"] = {}
for lab, a, b in [("1963-1989", 196307, 198912), ("1990-2015", 199001, 201512), ("2003-2015", 200301, 201512)]:
    s = (dv >= a) & (dv <= b)
    L = low[s]; M = np.array([mk[k] for k in dv[s]]); R = np.array([rf[k] for k in dv[s]])
    beta = np.cov(L - R, M - R)[0, 1] / np.var(M - R, ddof=1)
    OUT["low_var_quintile_vw"][lab] = {"low_excess": ann(L - R, 12), "mkt_excess": ann(M - R, 12),
                                       "active_low_minus_mkt": ann(L - M, 12), "beta": r(beta),
                                       "capm_alpha_ann_pct": r(1200 * ((L - R) - beta * (M - R)).mean(), 2)}


# ---- 3. industry seasonality
def seasonality(name, K):
    di, ci, mi = read_block(name, ci_hdr[name], False, block_title="Average Value Weighted Returns -- Monthly")
    years, months = di // 100, di % 100
    acts, turns, ds, prev = [], [], [], None
    for t in range(len(di)):
        y, mo = years[t], months[t]
        past = [(k) for k in range(t) if months[k] == mo and y - 20 <= years[k] <= y - 1]
        if len(past) < 20:
            continue
        sig = np.nanmean(mi[past], axis=0)
        top = set(np.argsort(-sig)[:K])
        acts.append(np.nanmean(mi[t, list(top)]) - np.nanmean(mi[t]))
        ds.append(di[t])
        if prev is not None:
            turns.append(len(top - prev) / K)
        prev = top
    acts, ds, turns = np.array(acts), np.array(ds), np.array([np.nan] + turns)
    res = {}
    for lab, a, b in [("first-1989", 0, 198912), ("1990-2015", 199001, 201512), ("2003-2015", 200301, 201512)]:
        s = (ds >= a) & (ds <= b)
        res[lab] = {"active_vs_ew": ann(acts[s], 12), "mean_share_replaced_per_month": r(np.nanmean(turns[s])),
                    "first_month": int(ds[s][0])}
    return res


ci_hdr = {"12_Industry_Portfolios": "NoDur", "49_Industry_Portfolios": "Agric"}
OUT["industry_seasonality_top3_of_12"] = seasonality("12_Industry_Portfolios", 3)
OUT["industry_seasonality_top5_of_49"] = seasonality("49_Industry_Portfolios", 5)
json.dump(OUT, open(os.path.join(HERE, "..", "results", "screen_xs.json"), "w"), indent=1, sort_keys=True)
print(json.dumps(OUT, indent=1))
