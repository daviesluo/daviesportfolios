"""Treasury auction cycle (Lou, Yan & Zhang 2013, RFS: prices fall in the days before an auction, recover after),
screened on 1990-2015 only, as a candidate for a USD UCITS long-Treasury line in the USD account.

Inputs (keyless, all dated <= 2015-12-31): the US Treasury's daily par yield curve CSVs, one per year, and
TreasuryDirect's auction search (securities auctioned 1990-01-01 .. 2015-12-31, notes and bonds).
Events: every 10-year note auction (original or reopening; securityTerm 9-10 years) on the 10-year yield, and every
30-year bond auction (29-30 years) on the 30-year yield (the 20-year column stands in for 2002-02 .. 2006-02, when
the 30-year was not published). Windows in trading days around the auction day t (yields are end of day, after the
13:00 ET auction): pre = close t-5 -> close t-1, day = t-1 -> t, post = t -> t+5. Each against the mean 5-day (or
1-day) change over all days (drift). Price terms for a 20+ year Treasury ETF: -17 x the 30-year yield change
(duration 17, an ASSUMPTION). Output: ../results/screen_auctions.json
"""
import csv, glob, json, math, os
from datetime import datetime
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
U = os.path.join(HERE, "..", "inputs", "ust")
curve = {}
for f in sorted(glob.glob(os.path.join(U, "ycurve_*.csv"))):
    for row in csv.DictReader(open(f)):
        d = datetime.strptime(row["Date"], "%m/%d/%Y").date()
        if d.year > 2015:
            continue
        g = lambda k: float(row[k]) if row.get(k) not in (None, "", "N/A") else None
        curve[d] = {"10": g("10 Yr"), "30": g("30 Yr") if g("30 Yr") is not None else g("20 Yr")}
days = sorted(curve)
idx = {d: i for i, d in enumerate(days)}
assert max(days).year <= 2015
auc = json.load(open(os.path.join(U, "td_notes.json"))) + json.load(open(os.path.join(U, "td_bonds.json")))


def term_years(t):
    y = int(t.split("-Year")[0]) if "-Year" in t else 0
    return y + (1 if "Month" in t and y in (9, 29) else 0)


ev = {"10": [], "30": []}
for a in auc:
    ty = term_years(a["securityTerm"])
    k = "10" if ty == 10 else ("30" if ty == 30 else None)
    if not k:
        continue
    d = datetime.fromisoformat(a["auctionDate"]).date()
    if d in idx:
        ev[k].append(idx[d])
OUT = {}
for k in ("10", "30"):
    y = np.array([curve[d][k] if curve[d][k] is not None else np.nan for d in days])
    dy1 = np.r_[np.nan, np.diff(y)] * 100                     # bp a day
    res = {"events": len(set(ev[k]))}
    for lab, (a, b) in {"pre_t-5_t-1": (-5, -1), "day_t-1_t": (-1, 0), "post_t_t+5": (0, 5)}.items():
        vals = np.array([y[i + b] - y[i + a] for i in sorted(set(ev[k])) if i + a >= 0 and i + b < len(y)]) * 100
        vals = vals[~np.isnan(vals)]
        drift = np.nanmean(dy1) * (b - a)
        ab = vals - drift
        res[lab] = {"n": len(vals), "mean_bp": round(float(vals.mean()), 3), "abn_mean_bp": round(float(ab.mean()), 3),
                    "sd_bp": round(float(vals.std(ddof=1)), 3), "t_abn": round(float(ab.mean() / ab.std(ddof=1) * math.sqrt(len(ab))), 2)}
    for lab2, lo, hi in (("1990-2002", 1990, 2002), ("2003-2015", 2003, 2015)):
        ii = [i for i in sorted(set(ev[k])) if lo <= days[i].year <= hi and i - 5 >= 0 and i + 5 < len(y)]
        post = np.array([y[i + 5] - y[i] for i in ii]) * 100
        pre = np.array([y[i - 1] - y[i - 5] for i in ii]) * 100
        post, pre = post[~np.isnan(post)], pre[~np.isnan(pre)]
        res[lab2] = {"n": len(ii), "pre_mean_bp": round(float(pre.mean()), 3), "pre_t": round(float(pre.mean() / pre.std(ddof=1) * math.sqrt(len(pre))), 2),
                     "post_mean_bp": round(float(post.mean()), 3), "post_t": round(float(post.mean() / post.std(ddof=1) * math.sqrt(len(post))), 2),
                     "post_price_pct_dur17": round(float(-17 * post.mean() / 100), 3)}
    OUT[k + "y"] = res
json.dump(OUT, open(os.path.join(HERE, "..", "results", "screen_auctions.json"), "w"), indent=1, sort_keys=True)
print(json.dumps(OUT, indent=1))
