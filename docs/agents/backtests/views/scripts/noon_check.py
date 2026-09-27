"""VIEWS: how sharply do the day-1 markets wake at 12:00 ET? The check on the `noon` posting estimates.

For every exploration day-1 event whose P came from the noon rule, the event's prints per minute from 11:30 to 12:40 ET
on the posting day, summed over events, and per event the first minute at or after 11:50 ET with at least five prints
(the market's first reaction to the counter). A posting at 12:00:00–12:00:25 ET shows as a surge from the 12:00–12:05
minutes; a later upload shows as a later surge.

usage: noon_check.py <universe json> <posting json> <out json>
"""
import json
import os
import sys
from collections import Counter
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402

ET = ZoneInfo("America/New_York")


def main():
    uni = {e["event"]: e for e in V.jfile(sys.argv[1])["events"]}
    post = V.jfile(sys.argv[2])["events"]
    agg = Counter()
    firsts = []
    for r in post:
        if r["p_source"] != "noon":
            continue
        rows = V.prints(r["event"])
        p = r["P"] - 10  # 12:00:00 ET
        c = Counter(int((x[0] - p) // 60) for x in rows if p - 1800 <= x[0] < p + 2400)
        for k, v in c.items():
            agg[k] += v
        first = next((k for k in range(-10, 40) if c.get(k, 0) >= 5), None)
        firsts.append({"event": r["event"], "slug": r["slug"], "posted_et": datetime.fromtimestamp(p, ET).strftime("%Y-%m-%d %a"),
                       "first_minute_with_5_prints": first, "prints_11_50_to_12_00": sum(c.get(k, 0) for k in range(-10, 0)),
                       "prints_12_00_to_12_10": sum(c.get(k, 0) for k in range(0, 10))})
    out = {"minutes_from_12_00_ET": {str(k): agg[k] for k in range(-30, 40)}, "events": firsts,
           "first_minute_counts": dict(Counter(str(f["first_minute_with_5_prints"]) for f in firsts))}
    with open(sys.argv[3], "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    for k in range(-15, 30):
        print(f"{k:+3d} {agg[k]:5d} " + "#" * (agg[k] // 20))
    for f in firsts:
        print(f["posted_et"], f["first_minute_with_5_prints"], f["prints_11_50_to_12_00"], f["prints_12_00_to_12_10"], f["slug"][:50])


if __name__ == "__main__":
    main()
