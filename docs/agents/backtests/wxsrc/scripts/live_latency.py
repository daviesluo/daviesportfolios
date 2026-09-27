"""WXSRC A3 summary: each source's delay after its data time, from `poll_live.py`'s record.

For every new version a source showed after the poller's first poll of it (a first sighting is not a latency sample):
its data time d (the slot or the report's observation time), the source's own Last-Modified (where it sends one), the
instant this machine first saw it and the previous poll that did not show it (the version appeared between the two).
The delay is reported three ways: Last-Modified − d; first seen − d (an upper bound, at a 5 s poll); the previous
poll − d (a lower bound). Clock: this machine's offset against Binance's server time is recorded beside it.

usage: live_latency.py <live dir> <out json>
"""
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wxcommon as X  # noqa: E402


def main():
    d, outp = sys.argv[1], sys.argv[2]
    rows = [json.loads(x) for x in open(os.path.join(d, "obs.jsonl"))]
    clock = [json.loads(x) for x in open(os.path.join(d, "clock.jsonl"))] if os.path.exists(
        os.path.join(d, "clock.jsonl")) else []
    run = [json.loads(x) for x in open(os.path.join(d, "run.jsonl"))]
    polls = defaultdict(lambda: [0, 0])
    for x in open(os.path.join(d, "polls.jsonl")):
        p = json.loads(x)
        polls[p["src"]][0] += 1
        polls[p["src"]][1] += p["status"] not in (200, 304)
    by = defaultdict(list)
    samples = []
    # a source's own Last-Modified is its write time even on the poller's first read of it
    written = defaultdict(dict)
    for r in rows:
        if r.get("lm") and r.get("data_ts") is not None:
            name = r["src"] + ("|" + r["st"] if r.get("st") else "")
            du = datetime.fromtimestamp(float(r["data_ts"]), timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
            written[name][du] = round(r["lm"] - float(r["data_ts"]), 1)
    for r in rows:
        if r.get("initial") or r.get("data_ts") is None:
            continue
        dt = float(r["data_ts"])
        name = r["src"] + ("|" + r["st"] if r.get("st") else "")
        rec = {"source": name, "data_utc": datetime.fromtimestamp(dt, timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
               "seen_after_s": round(r["seen"] - dt, 1),
               "prev_after_s": round(r["prev"] - dt, 1) if r.get("prev") else None,
               "lm_after_s": round(r["lm"] - dt, 1) if r.get("lm") else None,
               "receipt_after_s": round(datetime.fromisoformat(r["receipt"].replace("Z", "+00:00")).timestamp() - dt, 1)
               if r.get("receipt") else None,
               "value": r.get("values") or r.get("air_temp") or r.get("temp")}
        samples.append(rec)
        by[name].append(rec)
    summ = {}
    for name, xs in sorted(by.items()):
        summ[name] = {"n": len(xs), "seen_after_s": X.pct([x["seen_after_s"] for x in xs], (0.1, 0.5, 0.9)),
                      "lm_after_s": X.pct([x["lm_after_s"] for x in xs], (0.1, 0.5, 0.9)),
                      "receipt_after_s": X.pct([x["receipt_after_s"] for x in xs], (0.1, 0.5, 0.9))}
    start = run[0].get("start") if run else None
    out = {"window_utc": [datetime.fromtimestamp(start, timezone.utc).isoformat() if start else None,
                          datetime.fromtimestamp(max(r["seen"] for r in rows), timezone.utc).isoformat()],
           "polls": {k: {"requests": v[0], "failed": v[1]} for k, v in sorted(polls.items())},
           "clock_offset_s": X.pct([c["offset_s"] for c in clock], (0.1, 0.5, 0.9)),
           "summary": summ, "samples": samples, "ua": X.UA,
           "last_modified_after_data_s": {k: dict(sorted(v.items())) for k, v in sorted(written.items())}}
    with open(outp, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    for k, v in summ.items():
        print(k, v)


if __name__ == "__main__":
    main()
