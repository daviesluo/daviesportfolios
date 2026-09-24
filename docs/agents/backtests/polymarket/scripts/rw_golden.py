"""RW's golden fixture for the paper engine's replay test (agents/pmrw.test.ts).

From RW's committed input and result, keep what the TypeScript port of the rule must reproduce exactly:
* every market's first recorded row (RW's selection ranks all 2,821 by it) and the primary it chose;
* the full minute series and prints of the primary's ten markets and of the ten best and ten worst markets of the
  every-market arm, with the per-market results rw_test.py wrote for them;
* the portfolio sums of the primary, its stress arm and the every-market arm;
* raw books of those markets at three recorded minutes, with the rows rw_inputs.py summarised them into, when the raw
  books are at hand ($PM_DATA/rw/books; they are not committed).

usage: rw_golden.py <rw_inputs .json.gz> <rw_run1 .json> <out .json>
"""
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402

KEYS = ("reward", "fill_pnl", "total", "fills", "fill_shares", "net_end", "resolved", "mark", "capital", "first_cap",
        "quoted_minutes")


def main():
    inp, res, outp = sys.argv[1], sys.argv[2], sys.argv[3]
    with gzip.open(inp, "rb") as f:
        blob = json.loads(f.read())
    run = json.load(open(res))
    mk = blob["markets"]
    expect = {}
    for group in ("primary_markets", "all_top10_total", "all_bottom10_total"):
        for r in run[group]:
            expect[r["cond"]] = {k: r[k] for k in KEYS}
    firsts = {c: {"rate": m["rate"], "v": m["v"], "min_size": m["min_size"], "tick": m["tick"],
                  "first": m["series"][0] if m["series"] else None} for c, m in sorted(mk.items())}
    markets = {c: {k: mk[c][k] for k in ("rate", "v", "min_size", "tick", "series", "prints", "status")} for c in sorted(expect)}
    raw = []
    books_dir = os.path.join(pmnet.DATA, "rw", "books")
    if os.path.isdir(books_dir):
        for minute in (blob["first_minute"], blob["first_minute"] + 3600 * 5, blob["first_minute"] + 3600 * 7 + 1800):
            p = os.path.join(books_dir, f"{minute}.json")
            if not os.path.exists(p):
                continue
            rec = pmnet.load(p)
            for c in sorted(expect):
                row = next((r for m_, r in mk[c]["series"] if m_ == minute), None)
                raw.append({"cond": c, "minute": minute, "v": mk[c]["v"], "min_size": mk[c]["min_size"],
                            "book": rec["books"].get(c), "row": row})
    out = {"source": {"inputs": os.path.basename(inp), "result": os.path.basename(res)},
           "first_minute": blob["first_minute"], "window_s": blob["window_s"],
           "primary": [r["cond"] for r in run["primary_markets"]],
           "firsts": firsts, "markets": markets, "expect": expect,
           "sums": {"primary": run["primary"], "stress": run["stress"], "all": run["all_markets"]},
           "raw_books": raw}
    with open(outp, "w") as f:
        json.dump(out, f, sort_keys=True, separators=(",", ":"))
    print("markets", len(markets), "firsts", len(firsts), "raw", len(raw), "bytes", os.path.getsize(outp))


if __name__ == "__main__":
    main()
