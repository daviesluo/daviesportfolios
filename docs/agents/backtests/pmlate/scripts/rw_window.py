"""PMLATE: print the tape of one bucket around the report that killed or locked it (exploration aid, RW's days).

usage: rw_window.py <event id> <bucket lo|None> [minutes before] [minutes after]
Times are seconds from the report's AWC receipt (or its observation time when AWC has none); each line: taker's
direction on YES, the YES-equivalent price, shares, the taker's wallet (last 6 hex).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
from rw_mechanism import yes_px  # noqa: E402


def main():
    eid, lo = sys.argv[1], sys.argv[2]
    before = float(sys.argv[3]) if len(sys.argv) > 3 else 60
    after = float(sys.argv[4]) if len(sys.argv) > 4 else 60
    res = C.load_json(os.path.join(C.DATA, "rw", "mechanism.json"))
    ev = next(r for r in res if r["event"] == eid)
    b = next(x for x in ev["buckets"] if str(x["bucket"][0]) == lo)
    t0 = b["pub_ts"] or b["obs_ts"]
    print(ev["date"], ev["city"], ev["hl"], b["bucket"], b["state"], "obs", C.iso(b["obs_ts"]), "pub", C.iso(t0),
          "value", b["value"], "payout", b["payout"])
    pr = C.prints_of(b["cond"], os.path.join(C.DATA, "prints"))["prints"]
    for p in pr:
        if not (t0 - before * 60 <= p["ts"] <= t0 + after * 60):
            continue
        d, y = yes_px(p)
        print(f"  {p['ts'] - t0:+7.0f}s {C.iso(p['ts'])[11:19]} {d:4} yes {y:.3f} size {p['size']:9.2f} "
              f"${p['size'] * p['price']:8.2f} {str(p['wallet'])[-6:]}")


if __name__ == "__main__":
    main()
