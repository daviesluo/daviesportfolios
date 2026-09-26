"""PMLATE step 1a: the daily temperature events behind RW's same-day market-days, every bucket of each.

Reads the conditions RW quoted (given on the command line or in a file, one per line), asks Gamma for each market
and then for its whole event (every bucket), and writes $PMLATE_DATA/rw/events.json: per event the city, high or low,
unit, date, station, resolution source, and every bucket with its tokens, payout and closed time.
"""
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402


def gamma_markets(conds):
    out = []
    for closed in ("true", "false"):
        q = [("limit", "100"), ("closed", closed)] + [("condition_ids", c) for c in conds]
        out += C.pmnet.get(C.GAMMA + "/markets?" + urllib.parse.urlencode(q)) or []
    return out


def main():
    src = sys.argv[1]
    conds = [l.strip() for l in open(src) if l.strip()] if os.path.exists(src) else sys.argv[1:]
    ms = gamma_markets(conds)
    events = {}
    for m in ms:
        p = C.parse_market(m)
        if not p:
            print("not a temperature bucket:", m.get("question"))
            continue
        events.setdefault(p["event"], {"rw_conds": []})["rw_conds"].append(p["cond"])
    for eid, e in events.items():
        d = C.pmnet.get(C.GAMMA + "/events/" + eid)
        buckets = []
        for m in d.get("markets") or []:
            p = C.parse_market(m)
            if p:
                buckets.append(p)
        buckets.sort(key=lambda b: (b["bucket"][0] if b["bucket"][0] is not None else -999))
        b0 = buckets[0]
        e.update({"event": eid, "slug": d.get("slug"), "title": d.get("title"), "city": b0["city"], "date": b0["date"],
                  "hl": b0["hl"], "unit": b0["unit"], "station": b0["station"], "source": b0["source"],
                  "src_url": b0["src_url"], "end": b0["end"], "description": (d.get("markets") or [{}])[0].get("description"),
                  "buckets": buckets})
    C.dump_json(os.path.join(C.DATA, "rw", "events.json"), events)
    for eid, e in sorted(events.items(), key=lambda kv: (kv[1]["date"], kv[1]["city"])):
        win = [b["bucket"] for b in e["buckets"] if b["payout_yes"] == 1.0]
        print(eid, e["date"], e["city"], e["hl"], e["unit"], e["station"], e["source"], "buckets", len(e["buckets"]),
              "winner", win, "closed", C.iso(max(b["closed_time"] or 0 for b in e["buckets"])) if any(b["closed_time"] for b in e["buckets"]) else None)


if __name__ == "__main__":
    main()
