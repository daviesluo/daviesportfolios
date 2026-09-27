"""HARVEST: the committed input of one category — its units (one per market: C, the confirmed and the resolved outcome,
close, fee schedule) and, for each unit, every print of its market from C − 600 s to its close, compacted.

A print row is [ts, side (0 taker BUY / 1 taker SELL), outcome index, price, size, taker wallet tail (10 hex)]. Rows
come from the event walks `prints_pull.py` wrote under $HARVEST_DATA/prints; a unit whose event walk is missing or
incomplete, or did not reach C − 600 s, is dropped and counted. Nothing here decides anything from a price.

usage: inputs_build.py <units json> <out json.gz>
"""
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hcommon as H  # noqa: E402

PRE = 600


def main():
    u = H.jfile(sys.argv[1])
    units = u["units"]
    by_ev = defaultdict(list)
    for x in units:
        by_ev[x["event"]].append(x)
    kept, dropped = [], Counter()
    prints = {}
    for eid in sorted(by_ev, key=int):
        p = os.path.join(H.DATA, "prints", f"ev_{eid}.json")
        if not H.exists(p):
            dropped["no_walk"] += len(by_ev[eid])
            continue
        d = H.load(p)
        if not d.get("complete"):
            dropped["walk_incomplete"] += len(by_ev[eid])
            continue
        rows = defaultdict(list)
        for r in d["rows"]:
            rows[r[1]].append(r)
        for x in by_ev[eid]:
            if x.get("measured") is False:
                dropped["not_measured"] += 1
                continue
            if d["floor"] > x["C"] - PRE:
                dropped["walk_starts_after_C"] += 1
                continue
            rs = [[r[0], r[2], r[3], r[4], r[5], r[6]] for r in rows.get(x["cond"], [])
                  if x["C"] - PRE <= r[0] <= (x["closed"] or 0)]
            prints[x["cond"]] = sorted(rs)
            kept.append(x)
    out = {k: v for k, v in u.items() if k != "units"}
    out.update({"units": kept, "prints": prints, "dropped": dict(dropped), "pre_s": PRE})
    H.write_json(sys.argv[2], out, gz=True)
    print("units kept", len(kept), "dropped", dict(dropped), "prints", sum(len(v) for v in prints.values()))


if __name__ == "__main__":
    main()
