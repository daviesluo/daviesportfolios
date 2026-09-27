"""VIEWS exploration: what the CLOB's keyless `/prices-history` returns for a closed view market (printed).

Refuses any event the split holds out. usage: probe_history.py <universe json> <split json> <event id>
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402


def main():
    uni = {e["event"]: e for e in V.jfile(sys.argv[1])["events"]}
    split = V.jfile(sys.argv[2])
    eid = sys.argv[3]
    if eid in split["held_out_events"] or eid not in split["exploration_events"]:
        raise SystemExit("not an exploration event")
    e = uni[eid]
    m = e["markets"][0]
    end = int(e["closed_first"])
    for fid, span in ((1, 6 * 3600), (1, 3 * 86400), (60, 30 * 86400)):
        d = V.pmnet.get(V.CLOB + "/prices-history", {"market": m["yes"], "startTs": end - span, "endTs": end,
                                                     "fidelity": fid, "_": V.bust()})
        h = (d or {}).get("history") or []
        print("fidelity", fid, "span_h", span / 3600, "points", len(h), h[:3], h[-3:])


if __name__ == "__main__":
    main()
