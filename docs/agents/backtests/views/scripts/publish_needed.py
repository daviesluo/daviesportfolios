"""VIEWS: the YouTube reads that would turn every estimated deadline into an exact one (for the coordinator).

Every T here is estimated (`T_exact` false). The Data API gives the exact posting instant: `videos.list` (1 unit for
up to 50 ids, parts `snippet,contentDetails,liveStreamingDetails` — the publish time, the duration that tells a Short,
and a premiere's actual start) for every video a view event names, and `playlistItems.list` on the uploads playlist
(1 unit a page of 50) for the channels whose "next video" events name none, over the span those events were open.

usage: publish_needed.py <universe_table json> <out json>
"""
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402


def main():
    tab = V.jfile(sys.argv[1])["events"]
    ids = defaultdict(lambda: {"channel": None, "events": [], "splits": set()})
    spans = defaultdict(lambda: {"from": None, "to": None, "events": 0, "splits": set()})
    for r in tab:
        if r["kind"] not in ("video_window", "clock_count"):
            continue
        for v in r["videos_named"]:
            ids[v]["channel"] = r["channel"]
            ids[v]["events"].append(r["slug"])
            ids[v]["splits"].add(r["split"])
        if not r["videos_named"] and r["channel"]:
            s = spans[r["channel"]]
            a, b = r["created_utc"], r["closed_first_utc"]
            s["from"] = min(filter(None, [s["from"], a])) if a else s["from"]
            s["to"] = max(filter(None, [s["to"], b])) if b else s["to"]
            s["events"] += 1
            s["splits"].add(r["split"])
    out = {"note": "Reads for the coordinator (Data API, the recorder's key): exact publishedAt for the named videos, "
                   "and each channel's uploads over the span its unnamed 'next video' events were open.",
           "videos_list_ids": {k: {"channel": v["channel"], "events": len(v["events"]), "splits": sorted(v["splits"])}
                               for k, v in sorted(ids.items())},
           "videos_list_units": -(-len(ids) // 50),
           "uploads_spans": {k: {"from_utc": v["from"], "to_utc": v["to"], "events": v["events"], "splits": sorted(v["splits"])}
                             for k, v in sorted(spans.items())}}
    with open(sys.argv[2], "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
