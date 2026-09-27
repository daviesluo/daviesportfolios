"""VIEWS data step 3: every print of every market of each exploration event, from the data API.

The public trade feed filtered by Gamma event id (`/v2/trades?event_id=`, taker rows, newest first), walked back to the
event's creation (or a day before its first market's creation); each page's URL carries the walk's own millisecond,
so no cached copy of an earlier read answers it (PMLATE's `prints_pull.py`, the same walk with a different floor).
Rows are [ts, condition id, side, outcome_index, price, size, taker wallet tail, transaction hash tail]; the same fill
seen on two pages is kept once. Writes $VIEWS_DATA/prints/ev_<event>.json.gz with `complete` true when the walk reached
its floor.

Only events the split file lists as exploration are walked: a held-out event's prints are never requested.

usage: prints_pull.py <universe json> <split json> [k n]   (shard k of n: events whose id % n == k)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402

MAX_PAGES = 400


def main():
    uni = V.jfile(sys.argv[1])["events"]
    split = V.jfile(sys.argv[2])
    explore = set(split["exploration_events"])
    held = set(split["held_out_events"])
    k, n = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (0, 1)
    outdir = os.path.join(V.DATA, "prints")
    os.makedirs(outdir, exist_ok=True)
    done = 0
    for e in uni:
        eid = e["event"]
        if eid not in explore or eid in held or int(eid) % n != k:
            continue
        path = os.path.join(outdir, f"ev_{eid}.json")
        if V.exists(path):
            continue
        created = [m["created"] for m in e["markets"] if m.get("created")] + ([e["created"]] if e.get("created") else [])
        floor = int(min(created) - 86400) if created else 0
        rows, cursor, pages, complete = [], None, 0, False
        at = V.bust()
        try:
            while pages < MAX_PAGES:
                params = {"event_id": eid, "limit": 1000, "_": at}
                if cursor:
                    params["cursor"] = cursor
                d = V.pmnet.get(V.DATA_API + "/v2/trades", params)
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
        uniq = sorted({tuple(r) for r in rows})
        V.dump(path, {"event": eid, "floor": floor, "pages": pages, "complete": complete, "rows": uniq})
        done += 1
        print("event", eid, "pages", pages, "rows", len(uniq), "complete", complete, flush=True)
    print("shard", k, "done", done, flush=True)


if __name__ == "__main__":
    main()
