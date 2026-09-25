"""MARGIN: buy the side ahead by one goal per game over its last eight (fp5).

The fair value is how often that side then won. Not FORM5: goal difference,
eight matches, a gap of one goal. `--self-check` does not read a file.

usage: margin_test.py --self-check
       margin_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score

RULE = "MARGIN"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-margin.md"


def choose(ev, scores):
    return score.margin_quote(ev, scores, n=8, gap=1.0, minimum=8)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def self_check():
    score.assert_names()
    scores = []
    for i in range(8):
        scores.append(hold.played(i * 2, "HOT", "P%d" % i, 1, 0))
        scores.append(hold.played(i * 2 + 1, "Q%d" % i, "COLD", 1, 0))
    for i in range(8):
        scores.append(hold.played(20 + i, "HOT", "COLD", 2, 0))
    end = hold.day0() + 40 * 86400.0
    ev = hold.pack("margin-yes", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", hold.prints_for(end))
    _trade, hand = hold.assert_book(choose, scores, ev, "H", 1.0)
    print("self-check ok", "H", round(1.0, 6), round(hand, 6))


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
