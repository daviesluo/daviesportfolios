"""VIEWS: the committed inputs every analysis script reads, built from the raw pulls (which stay out of git).

* `prints`: inputs/exploration_prints.json.gz — every print of every exploration event (`prints_pull.py`), compact:
  per event its condition ids once and rows [ts, condition index, 0 BUY / 1 SELL (the taker's side), outcome index,
  price, size] at full precision (the wallet and hash tails are dropped).
* `mids`: inputs/exploration_mids.json.gz — the minute book midpoints `history_pull.py` read around each estimated
  deadline, as pulled.

Only exploration events exist in the raw pulls; a held-out id reaching this script stops it.

usage: inputs_build.py prints|mids <split json> <out json.gz>
"""
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vcommon as V  # noqa: E402


def main():
    what, split, outp = sys.argv[1], V.jfile(sys.argv[2]), sys.argv[3]
    held = set(split["held_out_events"])
    out = {}
    folder = {"prints": "prints", "mids": "hist"}[what]
    for p in V.pmnet.list_json(os.path.join(V.DATA, folder)):
        d = V.load(p)
        eid = str(d["event"])
        if eid in held:
            raise SystemExit(f"held-out event {eid} in the raw pulls")
        if what == "prints":
            conds = sorted({r[1] for r in d["rows"]})
            ci = {c: i for i, c in enumerate(conds)}
            out[eid] = {"complete": d["complete"], "floor": d["floor"], "conds": conds,
                        "rows": [[r[0], ci[r[1]], 0 if r[2] == "BUY" else 1, r[3], r[4], r[5]] for r in d["rows"]]}
        else:
            out[eid] = {"T": d["T"], "from": d["from"], "to": d["to"], "history": d["history"]}
    body = json.dumps({"what": what, "events": out}, separators=(",", ":"), sort_keys=True)
    with gzip.GzipFile(outp, "wb", mtime=0) as g:
        g.write(body.encode())
    print(what, "events", len(out))


if __name__ == "__main__":
    main()
