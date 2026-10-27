"""PMSAMEBET step 6: read the books of the near-violating relations once a minute for a while (keyless, read only).

The relations kept are those whose best cover had a touch edge of −2 cents or better in the snapshot named. Each
minute every cover is priced again (books.walk) and appended to $PM_DATA/record.jsonl. Nothing is placed: this is
the minute-scale view of how often and how long a gap stays open at the asks.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmsamebet/scripts/record.py <snapshot json> <minutes>
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402
import books as B  # noqa: E402


def main():
    snap, minutes = sys.argv[1], int(sys.argv[2])
    rows = pmnet.load(snap)
    keep = {r["id"] for r in rows if not r.get("missing_book") and r["touch_edge"] >= -0.02}
    R = [r for r in pmnet.load(os.path.join(pmnet.DATA, "relations.json")) if r["id"] in keep]
    print("relations recorded", len(R), flush=True)
    out = os.path.join(pmnet.DATA, "record.jsonl")
    t_end = time.time() + 60 * minutes
    n = 0
    while time.time() < t_end:
        t0 = time.time()
        try:
            rs, _ = B.snapshot(R)
        except RuntimeError as e:
            print("read failed", e, flush=True)
            rs = []
        with open(out, "a") as f:
            for r in rs:
                f.write(json.dumps(r, sort_keys=True) + "\n")
        n += 1
        if n % 10 == 0:
            print("minute", n, "read took", round(time.time() - t0, 1), "s", flush=True)
        time.sleep(max(0.0, 60 - (time.time() - t0)))


if __name__ == "__main__":
    main()
