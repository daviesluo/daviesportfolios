"""Share of S&P 500 member-quarters 2016-01-01 .. 2026-09-30 that belong to names Yahoo no longer serves.
Reads ../results/sp500_survivorship.json and the cached changes table; member time of a removed name runs from
max(2016-01-01, its last addition before removal) to its removal date. Total member time is 503 names x the window
(the walked-back count stays 504-508 through the window). Output: ../results/sp500_hole_share.json"""
import json, os
from datetime import date
HERE = os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE, "sp500_survivorship.py")).read().split("# completeness:")[0])   # parses ch (changes) only; no fetch: cached
S = json.load(open(os.path.join(HERE, "..", "results", "sp500_survivorship.json")))
W0, W1 = date(2016, 1, 1), date(2026, 9, 30)
yrs = (W1 - W0).days / 365.25
def last_add(tk, before):
    ds = [c["date"] for c in ch if c["added"] == tk and c["date"] < before]
    return max(ds) if ds else None
miss_y, all_rem_y = 0.0, 0.0
rows = []
for d in S["removed_detail"]:
    a = last_add(d["ticker"], d["date"])
    start = max(W0, date.fromisoformat(a)) if a else W0
    y = max(0.0, (date.fromisoformat(d["date"]) - start).days / 365.25)
    all_rem_y += y
    if not d["yahoo_answers"]:
        miss_y += y
    rows.append((d["ticker"], d["class"], d["yahoo_answers"], round(y, 2)))
total_y = 503 * yrs
out = {"window_years": round(yrs, 2), "member_years_total_approx": round(total_y, 0),
       "member_years_of_removed_names": round(all_rem_y, 1), "member_years_missing_on_yahoo": round(miss_y, 1),
       "share_of_member_time_missing_pct": round(100 * miss_y / total_y, 2),
       "announcements_missing_approx": round(4 * miss_y), "announcements_total_approx": round(4 * total_y),
       "removed_names_missing_on_yahoo": sum(1 for r in rows if not r[2])}
json.dump(out, open(os.path.join(HERE, "..", "results", "sp500_hole_share.json"), "w"), indent=1, sort_keys=True)
print(json.dumps(out, indent=1))
