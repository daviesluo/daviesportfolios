"""FAV data step 4: the compact, committed input of the test (fp4).

Joins the universe, the price at each decision time and, for each horizon, the
prints inside that horizon's entry window (T_d, T_d + 60 min] into one gzipped
JSON the test reads (`inputs/fav_inputs.json.gz`). A market whose print walk did
not reach a window is marked, so the test counts it rather than reading it as
"no print". Writes the path given on the command line.

usage: fav_inputs.py <out .json.gz>
"""
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

WINDOW = 3600


def main():
    outp = sys.argv[1]
    uni = pmnet.load(os.path.join(pmnet.DATA, "fav", "universe.json"))
    prices = pmnet.load(os.path.join(pmnet.DATA, "fav", "prices.json"))
    tdir = os.path.join(pmnet.DATA, "fav", "trades")
    rows = []
    for m in uni:
        pr = prices.get(m["cond"]) or {}
        tr = None
        tp = os.path.join(tdir, m["cond"] + ".json")
        if os.path.exists(tp):
            tr = pmnet.load(tp)
        win = {}
        for h, td in m["tds"].items():
            if tr is None:
                win[h] = None
                continue
            oldest = tr["rows"][-1][0] if tr["rows"] else None
            reached = tr.get("complete") or (oldest is not None and oldest <= td)
            if not reached:
                win[h] = "incomplete"
                continue
            win[h] = sorted([r for r in tr["rows"] if td < r[0] <= td + WINDOW], key=lambda r: r[0])
        rows.append({"cond": m["cond"], "event": m["event"], "cat": m["cat"], "fee_rate": m["fee_rate"],
                     "tick": m["tick"], "payout": m["payout"], "end": m["end"], "closed": m["closed"],
                     "tds": m["tds"], "p0": {h: (x[1] if x else None) for h, x in pr.items()},
                     "prints": win, "neg": m["neg"], "q": m["q"][:80]})
    rows.sort(key=lambda r: r["cond"])
    blob = json.dumps({"window_s": WINDOW, "markets": rows}, sort_keys=True, separators=(",", ":")).encode()
    with gzip.GzipFile(outp, "wb", mtime=0) as f:
        f.write(blob)
    print("markets", len(rows), "bytes", len(blob))


if __name__ == "__main__":
    main()
