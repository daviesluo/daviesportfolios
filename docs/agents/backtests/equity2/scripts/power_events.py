"""Forward-test power for the two event strategies on S&P 500 stocks in the USD account (no FX).

Every input below is an ASSUMPTION or a published figure, labelled; nothing here reads a return.
  PEAD: top quintile of each season's S&P 500 announcements by the [-1,+1] announcement return (Chan, Jegadeesh &
        Lakonishok 1996's measure, computable from prices alone), held from day +2 for 60 trading days, measured
        against the index. Events ~2,000 a year (500 firms x 4), top quintile 400. Per-event sd of a 60-day abnormal
        return 12.2 % (25 % idiosyncratic vol x sqrt(60/252); EQ1's assumption). Clustering in four seasons: the
        effective count is n/2 or n/4.
  EAP:  every S&P 500 announcement, held from the close of day -5 to the close of day +1 around the announcement
        (dates from the issuers' calendars; EDGAR 8-K item 2.02 confirms them after the fact), against the index.
        Per-event sd of the 7-day abnormal return 6 % (ASSUMPTION: large-cap earnings windows); effective n/2.
Output: ../results/power_events.json
"""
import json, math, os
from scipy.stats import norm

HERE = os.path.dirname(os.path.abspath(__file__))
Z = norm.ppf(0.95) + norm.ppf(0.80)
OUT = {"z_one_sided_5pct_power_80": round(Z, 3)}
pead = {"events_per_year": 400, "sd_event_pct": 12.2}
for yrs in (1, 2, 3, 5):
    for div in (2, 4):
        n = 400 * yrs / div
        pead[f"mde_pct_{yrs}y_neff_div{div}"] = round(Z * 12.2 / math.sqrt(n), 2)
pead["power_if_true_drift_0_5pct_3y_div2"] = round(float(norm.cdf(0.5 / (12.2 / math.sqrt(600)) - norm.ppf(0.95))), 3)
pead["power_if_true_drift_1_0pct_3y_div2"] = round(float(norm.cdf(1.0 / (12.2 / math.sqrt(600)) - norm.ppf(0.95))), 3)
pead["cost_round_trip_pct_usd_account"] = 0.03
pead["published"] = "Martineau (2022, CFR 11:613-646), CRSP 1984-2019: no PEAD in large stocks since 2006"
OUT["PEAD"] = pead
eap = {"events_per_year": 2000, "sd_event_pct": 6.0, "neff_div": 2}
for yrs in (1, 2, 3):
    n = 2000 * yrs / 2
    eap[f"mde_pct_{yrs}y"] = round(Z * 6.0 / math.sqrt(n), 3)
    for eff in (0.1, 0.2, 0.3):
        eap[f"power_{yrs}y_true_{eff}pct"] = round(float(norm.cdf(eff / (6.0 / math.sqrt(n)) - norm.ppf(0.95))), 3)
eap["cost_round_trip_pct_usd_account"] = 0.03
eap["note"] = "a book of every announcer: ~2,000 round trips a year at $1k-$20k is $5-$100 a position"
OUT["EAP"] = eap
json.dump(OUT, open(os.path.join(HERE, "..", "results", "power_events.json"), "w"), indent=1, sort_keys=True)
print(json.dumps(OUT, indent=1))
