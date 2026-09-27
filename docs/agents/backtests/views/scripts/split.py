"""VIEWS: the split between the months exploration reads and the months held out for a pre-registered test.

Decided before any price or print was read, from Gamma's records alone. An event's instant is T0 = its first market's
close − 2 h: UMA's proposal liveness on these markets is two hours, so T0 is an upper bound on the deadline (the
recent events closed 2 h 2 min after it). Events of the kinds whose prints the study reads (`video_window`,
`clock_count`) with T0 before the boundary are exploration; those with T0 at or after it are held out, and no price,
print or book of theirs is requested by any script here. Their Gamma records (brackets, winner, volume, fees, UMA
status) were read to build the universe, and that is disclosed wherever the split matters.

usage: split.py <universe json> <out json>
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402

BOUNDARY = "2026-06-01T00:00:00Z"
LIVENESS_S = 7200
KINDS = ("video_window", "clock_count")


def main():
    uni = V.jfile(sys.argv[1])["events"]
    b = datetime.fromisoformat(BOUNDARY.replace("Z", "+00:00")).timestamp()
    ex, held = [], []
    for e in uni:
        if e["kind"] not in KINDS or not e.get("closed_first"):
            continue
        t0 = e["closed_first"] - LIVENESS_S
        (ex if t0 < b else held).append(e["event"])
    out = {"boundary": BOUNDARY, "rule": "T0 = first market close - 7200 s; exploration when T0 < boundary; kinds " +
           ",".join(KINDS), "exploration_events": ex, "held_out_events": held,
           "counts": {"exploration": len(ex), "held_out": len(held)}}
    with open(sys.argv[2], "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print(out["counts"])


if __name__ == "__main__":
    main()
