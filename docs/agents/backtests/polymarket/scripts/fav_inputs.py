"""FAV data step 4: the compact, committed input of the test (fp4).

Joins the universe, the price at each decision time and, for each horizon, the
prints inside that horizon's entry window (T_d, T_d + 60 min] into one gzipped
JSON the test reads (`inputs/fav_inputs.json.gz`). A window the print walk did not
reach is marked "incomplete", and a market whose prints were not pulled (its
price never put a side at the pre-filter) is null, so the test counts either
rather than reading it as "no print". Writes the path given on the command line.

usage: fav_inputs.py <out .json.gz>
"""
import glob
import gzip
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

WINDOW = 3600


def main():
    outp = sys.argv[1]
    uni = pmnet.load(os.path.join(pmnet.DATA, "fav", "universe.json"))
    prices = pmnet.load(os.path.join(pmnet.DATA, "fav", "prices.json"))
    walks = {}
    rows_by_cond = defaultdict(list)
    for p in pmnet.list_json(os.path.join(pmnet.DATA, "fav", "trades_ev")):
        w = pmnet.load(p)
        oldest = min((r[0] for r in w["rows"]), default=None)
        for c in w["conds"]:
            walks[c] = {"since": w["since"], "complete": w["complete"], "oldest": oldest}
        for t, c, side, oi, price, size in w["rows"]:
            rows_by_cond[c].append([t, side, oi, price, size])
    out = []
    for m in uni:
        pr = prices.get(m["cond"]) or {}
        wk = walks.get(m["cond"])
        win = {}
        for h, td in m["tds"].items():
            if wk is None:
                win[h] = None
                continue
            reached = (wk["complete"] and wk["since"] <= td) or (wk["oldest"] is not None and wk["oldest"] <= td)
            if not reached:
                win[h] = "incomplete"
                continue
            win[h] = sorted(r for r in rows_by_cond[m["cond"]] if td < r[0] <= td + WINDOW)
        out.append({"cond": m["cond"], "event": m["event"], "cat": m["cat"], "fee_rate": m["fee_rate"],
                    "tick": m["tick"], "payout": m["payout"], "end": m["end"], "closed": m["closed"],
                    "tds": m["tds"], "p0": {h: (x[1] if x else None) for h, x in pr.items()},
                    "prints": win, "neg": m["neg"], "q": m["q"][:80]})
    out.sort(key=lambda r: r["cond"])
    blob = json.dumps({"window_s": WINDOW, "markets": out}, sort_keys=True, separators=(",", ":")).encode()
    with gzip.GzipFile(outp, "wb", mtime=0) as f:
        f.write(blob)
    print("markets", len(out), "bytes", len(blob))


if __name__ == "__main__":
    main()
