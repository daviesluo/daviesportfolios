"""HARVEST data step 1: every closed Gamma event under a set of tags, by scheduled end, compacted.

`GET /events?tag_id=<tag>&closed=true&end_date_min=<lo>&end_date_max=<hi>&limit=100&offset=<k>&_=<ms>` for each
window of `step` days (default 7) across the range, until a short page; each event compacted by
`hcommon.compact_event` (rules, markets, tokens, payouts, closed times, fee schedules, UMA status). An event under
several tags is kept once. Metadata only: no price, print or book is read here. Writes
$HARVEST_DATA/univ/<name>_<from>_<to>.json.gz.

usage: universe_pull.py <name> <tag,tag,...> <from YYYY-MM-DD> <to YYYY-MM-DD, exclusive> [step days]
"""
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hcommon as H  # noqa: E402


def main():
    name, tags, d0, d1 = sys.argv[1], sys.argv[2].split(","), sys.argv[3], sys.argv[4]
    step = int(sys.argv[5]) if len(sys.argv) > 5 else 7
    out = os.path.join(H.DATA, "univ", f"{name}_{d0}_{d1}.json")
    events = {}
    for tag in tags:
        day = datetime.fromisoformat(d0)
        end = datetime.fromisoformat(d1)
        while day < end:
            nxt = min(day + timedelta(days=step), end)
            lo, hi = day.strftime("%Y-%m-%dT00:00:00Z"), nxt.strftime("%Y-%m-%dT00:00:00Z")
            off = 0
            while True:
                page = H.pmnet.get(H.GAMMA + "/events", {"tag_id": tag, "closed": "true", "end_date_min": lo,
                                                         "end_date_max": hi, "limit": 100, "offset": off,
                                                         "_": H.bust()}) or []
                for ev in page:
                    eid = str(ev.get("id"))
                    if eid not in events:
                        events[eid] = H.compact_event(ev)
                if len(page) < 100:
                    break
                off += 100
            day = nxt
        print("tag", tag, "events so far", len(events), flush=True)
    H.dump(out, {"name": name, "tags": tags, "from": d0, "to": d1, "read_at": H.bust(), "events": events})
    print("events", len(events), "markets", sum(len(e["markets"]) for e in events.values()))


if __name__ == "__main__":
    main()
