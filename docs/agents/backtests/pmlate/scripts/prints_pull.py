"""PMLATE data step 3: every print of every bucket of each closed event, from the local day's start to the close.

The public trade feed filtered by Gamma event id (`/v2/trades?event_id=`, taker rows, newest first), walked back to
six hours before the station's local day began; every row kept: [ts, condition id, side, outcome_index, price, size,
taker wallet]. Each page's URL carries the walk's own millisecond (`_`), so no cached copy of an earlier read answers
it. The walk is marked complete when it reached that instant. Writes $PMLATE_DATA/prints/ev_<event>.json.

usage: prints_pull.py <events file> [k n]   (shard k of n: events whose id % n == k)
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import metar as W  # noqa: E402
from stations import tz_of  # noqa: E402

MAX_PAGES = 200


def main():
    ev = C.load_json(sys.argv[1])["events"]
    ev = list(ev.values()) if isinstance(ev, dict) else ev
    k, n = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (0, 1)
    outdir = os.path.join(C.DATA, "prints")
    os.makedirs(outdir, exist_ok=True)
    done = 0
    for e in ev:
        eid = str(e["event"])
        if not eid.isdigit() or int(eid) % n != k or not e.get("closed", True):
            continue
        path = os.path.join(outdir, f"ev_{eid}.json")
        if C.pmnet.exists(path):
            continue
        tz = "Asia/Hong_Kong" if e.get("station") == "HKO" else tz_of(e["station"])
        s, _ = W.local_day_bounds(e["date"], tz)
        floor = s - 6 * 3600
        rows, cursor, pages, complete = [], None, 0, False
        at = str(int(time.time() * 1000))
        try:
            while pages < MAX_PAGES:
                params = {"event_id": eid, "limit": 1000, "_": at}
                if cursor:
                    params["cursor"] = cursor
                d = C.pmnet.get(C.DATA_API + "/v2/trades", params)
                data = (d or {}).get("data") or []
                pages += 1
                for r in data:
                    t = int(r.get("timestamp") or 0)
                    if t >= floor:
                        rows.append([t, r.get("condition_id"), r.get("side"), r.get("outcome_index"),
                                     float(r.get("price") or 0), float(r.get("size") or 0),
                                     str(r.get("proxy_wallet") or "")[-8:], str(r.get("transaction_hash") or "")[-10:]])
                cursor = ((d or {}).get("pagination") or {}).get("next_cursor")
                if not cursor or not data or int(data[-1].get("timestamp") or 0) < floor:
                    complete = True
                    break
        except RuntimeError as err:
            print("error", eid, str(err)[:160], flush=True)
            continue
        # the same fill can come back on two pages when new prints shift the cursor: keep one of each
        uniq = sorted({tuple(r) for r in rows})
        C.dump_json(path, {"event": eid, "floor": floor, "pages": pages, "complete": complete, "rows": uniq})
        done += 1
        if done % 100 == 0:
            print("shard", k, "events", done, flush=True)
    print("shard", k, "done", done, flush=True)


if __name__ == "__main__":
    main()
