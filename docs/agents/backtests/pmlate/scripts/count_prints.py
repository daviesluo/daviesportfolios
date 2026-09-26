"""PMLATE, the count family: every print of every bucket of each closed post-count event, compactly.

The public trade feed by Gamma event id (`/v2/trades?event_id=`, taker rows, newest first, each page cache-busted),
walked back to the event's window start. Rows are [ts, condition index, 0 = BUY / 1 = SELL, outcome index, price,
size] with the event's condition ids listed once. Series named on the command line are walked whole; `--sample k`
keeps one event in k of the others (by event id), `--max-pages` caps a walk (a capped walk is marked incomplete).
Writes $PMLATE_DATA/count/prints/ev_<event>.json.gz.

usage: count_prints.py <universe file> <series,series,...> [--sample k] [--max-pages n] [--shard k n]
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402


def arg(name, default):
    return int(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


def main():
    uni = C.load_json(sys.argv[1])["events"]
    series = set(sys.argv[2].split(","))
    sample, max_pages = arg("--sample", 1), arg("--max-pages", 400)
    shard = (int(sys.argv[sys.argv.index("--shard") + 1]), int(sys.argv[sys.argv.index("--shard") + 2])) if "--shard" in sys.argv else (0, 1)
    outdir = os.path.join(C.DATA, "count", "prints")
    done = 0
    for e in sorted(uni.values(), key=lambda x: x["event"]):
        if e["family"] != "posts" or e["series"] not in series:
            continue
        eid = int(e["event"])
        if eid % sample != 0 or eid % shard[1] != shard[0]:
            continue
        path = os.path.join(outdir, f"ev_{eid}.json")
        if C.pmnet.exists(path):
            continue
        floor = int((e.get("start") or 0))
        conds = [m["cond"] for m in e["markets"]]
        ci = {c: i for i, c in enumerate(conds)}
        rows, cursor, pages, complete = [], None, 0, False
        at = str(int(time.time() * 1000))
        try:
            while pages < max_pages:
                params = {"event_id": str(eid), "limit": 1000, "_": at}
                if cursor:
                    params["cursor"] = cursor
                d = C.pmnet.get(C.DATA_API + "/v2/trades", params)
                data = (d or {}).get("data") or []
                pages += 1
                for r in data:
                    t = int(r.get("timestamp") or 0)
                    c = r.get("condition_id")
                    if t >= floor and c in ci:
                        rows.append((t, ci[c], 0 if r.get("side") == "BUY" else 1, r.get("outcome_index"),
                                     round(float(r.get("price") or 0), 6), round(float(r.get("size") or 0), 4),
                                     str(r.get("transaction_hash") or "")[-8:]))
                cursor = ((d or {}).get("pagination") or {}).get("next_cursor")
                if not cursor or not data or int(data[-1].get("timestamp") or 0) < floor:
                    complete = True
                    break
        except RuntimeError as err:
            print("error", eid, str(err)[:160], flush=True)
            continue
        rows = sorted(set(rows))
        C.dump_json(path, {"event": str(eid), "conds": conds, "floor": floor, "pages": pages, "complete": complete,
                           "rows": [list(r[:6]) for r in rows]})
        done += 1
        if done % 25 == 0:
            print("events", done, flush=True)
    print("done", done, flush=True)


if __name__ == "__main__":
    main()
