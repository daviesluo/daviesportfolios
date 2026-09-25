"""CORNERS: buy one full-time corner over from the two clubs' last eight matches (fp5).

The fair value of a line is the share of the pooled matches with more corners
than that line. The largest edge is bought. An equal edge keeps the lower line.
Unders are not bought. `--self-check` does not read a file.

usage: corner_test.py --self-check
       corner_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import stat_score as stat

RULE = "CORNERS"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-corners.md"
N = 8


def choose(ev, scores):
    return stat.corner_quote(ev, scores, n=N)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _corner(day, total):
    row = hold.played(day, "HOT", "COLD", 1, 0)
    row["hc"] = total // 2
    row["ac"] = total - total // 2
    return row


def self_check():
    score.assert_names()
    scores = [_corner(i, 12) for i in range(8)]
    end = hold.day0() + 40 * 86400.0
    markets = {
        "9.5": hold.market("9.5", 0.40, payout=1.0, end=end),
        "11.5": hold.market("11.5", 0.90, payout=1.0, end=end),
        "13.5": hold.market("13.5", 0.40, payout=0.0, end=end),
    }
    ev = hold.pack("corners-yes", end, "HOT", "COLD", markets, "9.5", hold.prints_for(end))
    ev["kind"] = "corners"
    _trade, hand = hold.assert_book(choose, scores, ev, "9.5", 1.0)
    tied = {
        "8.5": hold.market("8.5", 0.40, payout=1.0, end=end),
        "9.5": hold.market("9.5", 0.40, payout=1.0, end=end),
    }
    ev_tie = hold.pack("corners-tie", end, "HOT", "COLD", tied, "8.5", hold.prints_for(end))
    ev_tie["kind"] = "corners"
    hold.assert_book(choose, scores, ev_tie, "8.5", 1.0)
    if choose(ev, scores[:7]) is not None:
        raise SystemExit("seven matches traded")
    print("self-check ok", "9.5", round(1.0, 6), round(hand, 6))


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--self-check":
        self_check()
    else:
        with gzip.open(sys.argv[1], "rt") as f:
            data = json.load(f)
        out = run(data)
        with open(sys.argv[2], "w") as f:
            json.dump(out, f, indent=2, sort_keys=True)
            f.write("\n")
        print("passes", out["result"]["passes"], "oos", out["result"]["OOS"], "bar", out["result"]["bar"])
