"""VIEWS data step 4: each exploration market's book midpoint by the minute around its estimated deadline.

The CLOB's keyless `/prices-history?market=<YES token>&startTs=&endTs=&fidelity=1` answers the book's midpoint once a
minute (checked 2026-09-27 on four busy open markets outside the tag: its last point equals `/midpoint` and
(best bid + best ask) / 2). Pulled for T − 7 h → T + 3 h for every market of every exploration event with an estimated
deadline (`posting.py`); each read carries `_=<ms>`. Writes $VIEWS_DATA/hist/ev_<event>.json.gz: {token: [[t, p], …]}.
A held-out event is never requested.

usage: history_pull.py <universe json> <split json> <posting json>
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402

BEFORE_S = 7 * 3600
AFTER_S = 3 * 3600


def main():
    uni = {e["event"]: e for e in V.jfile(sys.argv[1])["events"]}
    split = V.jfile(sys.argv[2])
    ex, held = set(split["exploration_events"]), set(split["held_out_events"])
    post = V.jfile(sys.argv[3])["events"]
    outdir = os.path.join(V.DATA, "hist")
    os.makedirs(outdir, exist_ok=True)
    n = 0
    for r in post:
        eid = r["event"]
        if eid not in ex or eid in held or r.get("T") is None:
            continue
        path = os.path.join(outdir, f"ev_{eid}.json")
        if V.exists(path):
            continue
        T = int(r["T"])
        res = {}
        for m in uni[eid]["markets"]:
            if not m.get("yes"):
                continue
            try:
                d = V.pmnet.get(V.CLOB + "/prices-history", {"market": m["yes"], "startTs": T - BEFORE_S,
                                                            "endTs": T + AFTER_S, "fidelity": 1, "_": V.bust()})
                res[m["yes"]] = [[int(x["t"]), float(x["p"])] for x in (d or {}).get("history") or []]
            except RuntimeError as err:
                res[m["yes"]] = None
                print("error", eid, str(err)[:120], flush=True)
        V.dump(path, {"event": eid, "T": T, "from": T - BEFORE_S, "to": T + AFTER_S, "history": res})
        n += 1
    print("events", n)


if __name__ == "__main__":
    main()
