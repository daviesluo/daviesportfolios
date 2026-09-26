"""PMLATE data step 1 (older events): fp4's WX event list (2025-01 → 2026-09-10) in PMLATE's event shape.

fp4's committed `polymarket/inputs/wx_inputs.json.gz` lists every resolved daily temperature event it parsed (city,
date, high or low, unit, station, each bucket as a continuous interval, payout, closed time). Each interval
[lo - 0.5, hi + 0.5) becomes the whole-degree bucket [lo, hi]. The resolution source and the fee schedule are not in
that file, so Gamma is asked for one market of each event, fifty a request (the source and the schedule are the
event's). Writes $PMLATE_DATA/univ/events_wx.json.

usage: universe_wx.py <wx_inputs.json.gz>
"""
import gzip
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402


def whole(iv):
    lo = None if iv[0] is None else int(round(iv[0] + 0.5))
    hi = None if iv[1] is None else int(round(iv[1] - 0.5))
    return [lo, hi]


def main():
    with gzip.open(sys.argv[1], "rt") as f:
        wx = json.load(f)["events"]
    events = {}
    for e in wx:
        bks = [{"cond": m["cond"], "bucket": whole(m["iv"]), "payout_yes": m["payout_yes"], "closed_time": m["closed"],
                "start": m.get("start"), "tick": m.get("tick"), "fee_rate": None} for m in e["markets"]]
        events[str(e["event"])] = {"event": str(e["event"]), "city": e["city"], "date": e["date"], "hl": e["hl"],
                                   "unit": e["unit"], "station": e.get("station"), "closed": True, "buckets": bks,
                                   "source": None}
    firsts = [(eid, e["buckets"][0]["cond"]) for eid, e in events.items() if e["buckets"]]
    by_cond = {}
    for i in range(0, len(firsts), 50):
        chunk = firsts[i:i + 50]
        q = [("limit", "100"), ("closed", "true")] + [("condition_ids", c) for _, c in chunk]
        for m in C.pmnet.get(C.GAMMA + "/markets?" + urllib.parse.urlencode(q)) or []:
            by_cond[m.get("conditionId")] = m
        if i % 2000 == 0:
            print("gamma", i, len(by_cond), flush=True)
    for eid, c in firsts:
        m = by_cond.get(c)
        if not m:
            continue
        p = C.parse_market(m)
        fs = m.get("feeSchedule") or {}
        rate = fs.get("rate") if m.get("feesEnabled") else 0.0
        ev = events[eid]
        ev["source"] = p["source"] if p else None
        ev["src_url"] = (m.get("resolutionSource") or "")[:200]
        for b in ev["buckets"]:
            b["fee_rate"] = rate
    C.dump_json(os.path.join(C.DATA, "univ", "events_wx.json"), {"events": events})
    from collections import Counter
    print("events", len(events), "sources", Counter(e["source"] for e in events.values()),
          "fee rates", Counter(e["buckets"][0]["fee_rate"] for e in events.values() if e["buckets"]))


if __name__ == "__main__":
    main()
