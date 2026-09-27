"""HARVEST data step: every taker print of an exploration event, walked back from its last print to a floor.

The public trade feed filtered by Gamma event id (`/v2/trades?event_id=`, taker rows, newest first), each page's URL
carrying the walk's own millisecond (`_`) so no cached copy of an earlier read answers it. The walk stops when a page
reaches the floor (Unix s) and is marked complete then. Rows are [ts, condition id, side (0 BUY / 1 SELL), outcome
index, price, size, taker wallet tail (10 hex)]; the same fill seen on two pages is kept once.

Guard: only events the split lists as exploration are walked (a held-out event's prints are never requested), and
only when every market of the event closed before 2026-09-25 00:00 UTC.

The floors file is JSON: {"floors": {"<event id>": <floor Unix s>, ...}}. A later call with a lower floor for an
event already walked re-walks it to the lower floor.
Writes $HARVEST_DATA/prints/ev_<event>.json.gz.

usage: prints_pull.py <split json> <floors json> [k n] [--max-pages N]   (shard k of n: events whose id % n == k)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hcommon as H  # noqa: E402


def main():
    split = H.jfile(sys.argv[1])
    floors = H.jfile(sys.argv[2])["floors"]
    args = [a for a in sys.argv[3:] if not a.startswith("--")]
    k, n = (int(args[0]), int(args[1])) if len(args) >= 2 else (0, 1)
    max_pages = int(sys.argv[sys.argv.index("--max-pages") + 1]) if "--max-pages" in sys.argv else 2000
    explore = set()
    for c in split["categories"].values():
        explore.update(c["exploration"])
    outdir = os.path.join(H.DATA, "prints")
    os.makedirs(outdir, exist_ok=True)
    done = 0
    for eid in sorted(floors, key=int):
        if int(eid) % n != k:
            continue
        if eid not in explore:
            print("refused (not exploration)", eid, flush=True)
            continue
        floor = int(floors[eid])
        path = os.path.join(outdir, f"ev_{eid}.json")
        if H.exists(path):
            old = H.load(path)
            if old.get("complete") and old["floor"] <= floor:
                continue
        rows, cursor, pages, complete = [], None, 0, False
        at = H.bust()
        try:
            while pages < max_pages:
                params = {"event_id": eid, "limit": 1000, "_": at}
                if cursor:
                    params["cursor"] = cursor
                d = H.pmnet.get(H.DATA_API + "/v2/trades", params)
                data = (d or {}).get("data") or []
                pages += 1
                for r in data:
                    t = int(r.get("timestamp") or 0)
                    if t >= H.CUT:
                        raise RuntimeError(f"print at or after the cut in event {eid}")
                    if t >= floor:
                        rows.append((t, r.get("condition_id"), 0 if r.get("side") == "BUY" else 1, r.get("outcome_index"),
                                     round(float(r.get("price") or 0), 6), round(float(r.get("size") or 0), 6),
                                     str(r.get("proxy_wallet") or "")[-10:]))
                cursor = ((d or {}).get("pagination") or {}).get("next_cursor")
                if not cursor or not data or int(data[-1].get("timestamp") or 0) < floor:
                    complete = True
                    break
        except RuntimeError as err:
            print("error", eid, str(err)[:200], flush=True)
            continue
        uniq = sorted(set(rows))
        H.dump(path, {"event": eid, "floor": floor, "pages": pages, "complete": complete,
                      "rows": [list(r) for r in uniq]})
        done += 1
        print("event", eid, "pages", pages, "rows", len(uniq), "complete", complete, flush=True)
    print("shard", k, "done", done, flush=True)


if __name__ == "__main__":
    main()
