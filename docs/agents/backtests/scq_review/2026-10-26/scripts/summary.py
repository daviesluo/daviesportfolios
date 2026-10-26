"""2026-10-26 stablecoin quotes review: results/raw.json (scripts/series.ts) -> results/summary.json.

LIVE's figures are written as a share of its capital (%, bps a day, per £100), never in pounds: the repository is public
and they are the live account's money. The twins are paper, in pounds. Run from this folder: python3 -I scripts/summary.py
"""
import json, math, statistics as st, pathlib
from datetime import datetime

HERE = pathlib.Path(__file__).resolve().parent.parent
raw = json.loads((HERE / "results/raw.json").read_text())
CAP = {"LIVE": 120, "pr5": 1200, "live": 120, "p50": 600, "take50": 600, "take50wk": 600, "d": 1800}
NOW = raw["LIVE"]["series"][-1]["t"]   # the read's instant, as data/fairs.txt writes it
WINDOWS = [("since_1002", "2026-10-02T00:00:00Z", NOW), ("d14", "2026-10-12T00:00:00Z", NOW), ("d7", "2026-10-19T00:00:00Z", NOW),
           ("weekdays_1019_1022", "2026-10-19T00:00:00Z", "2026-10-23T00:00:00Z")]
WEEKEND = ("2026-10-23T21:00", "2026-10-25T21:00")
WEEKDAY_TRIPS = ("2026-10-12", "2026-10-23T21:00", 11.875)   # both LIVE and the twins without the weekend rule trade weekdays only here


def P(t): return datetime.fromisoformat(t.replace("Z", "+00:00"))


def at(s, t): return next(r for r in s if r["t"] == t)


out = {"now": NOW, "rows": {}}
for n, v in raw.items():
    if n == "now":
        continue
    c, s, live = CAP[n], v["series"], n == "LIVE"
    row = {"capital": "LIVE's (whole account)" if live else c, "entry_fills": v["entryFills"], "takes": v["takes"], "windows": {}}
    for name, t0, t1 in WINDOWS:
        if n == "take50wk" and t0 < "2026-10-19":
            continue
        r0, r1 = at(s, t0), at(s, t1)
        days = (P(t1) - P(t0)).total_seconds() / 86400
        R, M = r1["realised"] - r0["realised"], r1["total"] - r0["total"]
        tr = [x for x in v["trips"] if t0 <= x["tExit"] < t1]
        w = {"days": round(days, 3), "realised_pct_yr": round(R / c * 365 / days * 100, 2), "mtm_pct_yr": round(M / c * 365 / days * 100, 2),
             "realised_per_100_day": round(R / c * 100 / days, 4), "mtm_per_100_day": round(M / c * 100 / days, 4),
             "mtm_bps_day": round(M / c / days * 1e4, 2), "trips": len(tr), "won": sum(1 for x in tr if x["pnlGbp"] > 0),
             "stops": sum(1 for x in tr if x["how"] == "stop")}
        if not live:
            w.update({"realised_gbp": round(R, 4), "mtm_gbp": round(M, 4)})
        row["windows"][name] = w
    ss = [r for r in s if r["t"] >= ("2026-10-19" if n == "take50wk" else "2026-10-02")]   # variant-3 began 2026-10-19 00:00
    dm = [ss[i]["total"] - ss[i - 1]["total"] for i in range(1, len(ss))]
    cum = peak = mdd = 0.0
    for x in dm:
        cum += x; peak = max(peak, cum); mdd = min(mdd, cum - peak)
    row["daily_mtm"] = {"n": len(dm), "mean_bps": round(st.mean(dm) / c * 1e4, 2), "sd_bps": round(st.pstdev(dm) / c * 1e4, 2),
                        "worst_bps": round(min(dm) / c * 1e4, 2), "best_bps": round(max(dm) / c * 1e4, 2), "max_drawdown_pct": round(mdd / c * 100, 3),
                        "t": round(st.mean(dm) / (st.stdev(dm) / math.sqrt(len(dm))), 2)}
    row["unrealised_now_pct_of_capital"] = round(s[-1]["unrealised"] / c * 100, 3)
    row["coins_now_pct_of_capital"] = round(s[-1]["coinsGbp"] / c * 100, 1)
    wk = [x for x in v["trips"] if WEEKEND[0] <= x["tExit"] < WEEKEND[1]]
    row["first_live_weekend"] = {"trips": len(wk), "won": sum(1 for x in wk if x["pnlGbp"] > 0), "bps_of_capital": round(sum(x["pnlGbp"] for x in wk) / c * 1e4, 1)}
    a0, a1, nd = ("2026-10-19", WEEKDAY_TRIPS[1], 4.875) if n == "take50wk" else WEEKDAY_TRIPS
    wt = [x for x in v["trips"] if a0 <= x["tExit"] < a1]
    row["weekdays_to_1023_2100"] = {"from": a0, "trips": len(wt), "realised_per_100_day": round(sum(x["pnlGbp"] for x in wt) / c * 100 / nd, 4)}
    if live:
        dr = [d["realisedGbp"] for d in v["days"] if "2026-10-02" <= d["day"] < NOW[:10]]
        row["daily_realised"] = {"n": len(dr), "mean_bps": round(st.mean(dr) / c * 1e4, 2), "sd_bps": round(st.stdev(dr) / c * 1e4, 2),
                                 "t": round(st.mean(dr) / (st.stdev(dr) / math.sqrt(len(dr))), 2), "negative_days": sum(1 for x in dr if x < 0)}
        week = [d for d in v["days"] if "2026-10-19" <= d["day"] < "2026-10-26"]
        R7 = sum(d["realisedGbp"] for d in week)
        row["page_figure"] = {"days": [d["day"] for d in week], "realised_pct_of_capital": round(R7 / c * 100, 4),
                              "simple_annualised_pct": round(R7 / c * 365 / 7 * 100, 2),
                              "compounded_annualised_pct": round(((1 + R7 / c) ** (365 / 7) - 1) * 100, 1),
                              "weekend_share_pct": round(sum(x["pnlGbp"] for x in wk) / R7 * 100, 1)}
    out["rows"][n] = row
(HERE / "results/summary.json").write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
print("results/summary.json")
