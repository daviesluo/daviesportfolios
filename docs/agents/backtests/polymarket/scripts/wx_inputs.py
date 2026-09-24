"""WX data step 5: the compact, committed input of the test (fp4).

Joins the parsed events, the station forecasts (daily max/min of the 48- and
24-hour-ahead values, °C), each bucket's price at the decision time and the
prints of the hour after it into one gzipped JSON (`inputs/wx_inputs.json.gz`).

usage: wx_inputs.py <out .json.gz>
"""
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402
from wx_prices import HI, LO, t_decision  # noqa: E402


def main():
    outp = sys.argv[1]
    ev = pmnet.load(os.path.join(pmnet.DATA, "wx", "events.json"))
    fc = pmnet.load(os.path.join(pmnet.DATA, "wx", "forecasts.json"))
    prices = pmnet.load(os.path.join(pmnet.DATA, "wx", "prices.json"))
    rows = []
    for e in ev["events"]:
        if not (LO <= e["date"] < HI) or not e.get("station"):
            continue
        eid = str(e["event"])
        pp = os.path.join(pmnet.DATA, "wx", "prints", eid + ".json")
        pr = pmnet.load(pp) if pmnet.exists(pp) else None
        f = ((fc.get(e["station"]) or {}).get("days") or {}).get(e["date"]) or {}
        by = {}
        if pr:
            for t, c, side, oi, price, size in pr["rows"]:
                by.setdefault(c, []).append([t, side, oi, price, size])
        rows.append({"event": eid, "city": e["city"], "date": e["date"], "hl": e["hl"], "unit": e["unit"],
                     "station": e["station"], "td": t_decision(e["date"]), "f": f,
                     "prints_complete": bool(pr and pr.get("complete")), "prints_pulled": pr is not None,
                     "markets": [{"cond": m["cond"], "iv": m["iv"], "payout_yes": m["payout_yes"], "start": m["start"],
                                  "closed": m["closed"], "tick": m["tick"], "p": (prices.get(m["cond"]) or [None, None])[1],
                                  "prints": sorted(by.get(m["cond"], []))} for m in e["markets"]]})
    rows.sort(key=lambda r: (r["date"], r["city"], r["hl"], r["event"]))
    blob = json.dumps({"events": rows}, sort_keys=True, separators=(",", ":")).encode()
    with gzip.GzipFile(outp, "wb", mtime=0) as fh:
        fh.write(blob)
    print("events", len(rows), "bytes", len(blob))


if __name__ == "__main__":
    main()
