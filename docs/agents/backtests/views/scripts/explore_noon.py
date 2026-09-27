"""VIEWS exploration: does "posted at 12:00 ET" fit every exploration event? (printed; nothing written)

For each exploration `video_window` event: every 12:00:10 ET that could be its posting instant — at or after the event's
creation when the rules count the NEXT video, and early enough that the deadline plus UMA's two-hour liveness comes
before the first market closed — with the prints in the two hours after each candidate, and the close − T margin.

usage: explore_noon.py <universe json> <split json>
"""
import json
import os
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402

ET = ZoneInfo("America/New_York")


def main():
    uni = V.jfile(sys.argv[1])["events"]
    ex = set(V.jfile(sys.argv[2])["exploration_events"])
    for e in uni:
        if e["event"] not in ex or not e["window_h"]:
            continue
        rows = V.prints(e["event"])
        w = e["window_h"] * 3600
        hi = e["closed_first"] - 7200 - w
        lo = e["created"] - 14 * 86400
        d = datetime.fromtimestamp(lo, ET).date()
        cands = []
        while True:
            p = datetime(d.year, d.month, d.day, 12, 0, 10, tzinfo=ET).timestamp()
            if p > hi:
                break
            if p >= lo:
                n = sum(1 for r in rows if p <= r[0] < p + 7200)
                pre = sum(1 for r in rows if p - 7200 <= r[0] < p)
                cands.append((p, n, pre))
            d += timedelta(days=1)
        last = cands[-3:]
        s = []
        for p, n, pre in last:
            s.append(f"{datetime.fromtimestamp(p, ET).strftime('%a %m-%d')} n2h={n} pre2h={pre} cmT={(e['closed_first'] - p - w) / 3600:.2f}")
        print(e["slug"][:55].ljust(55), (e["channel"] or "")[:13].ljust(13), str(e["window_h"]).rjust(3),
              "N" if e["next_video"] else " ", datetime.fromtimestamp(e["created"], ET).strftime("%a %m-%d %H:%M"), " | ".join(s))


if __name__ == "__main__":
    main()
