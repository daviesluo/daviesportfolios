"""ELO: buy the full-time side a fixed Elo prices above the screen (fp5).

Ratings start at 1500. K is 20. Home advantage is 60 points. The draw
anchor is 0.25 and it shrinks as the ratings separate. None of those
numbers is fit on this sample. `--self-check` does not read a file.

usage: elo_test.py --self-check
       elo_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import math
import sys

import epl_hold as hold
import epl_score as score
import post_test as post

RULE = "ELO"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-elo.md"


def choose(ev, scores):
    return score.elo_quote(ev, scores, k=20.0, ha=60.0, anchor=0.25, minimum=8)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def self_check():
    score.assert_names()
    scores = [hold.played(i, "A%d" % i, "B%d" % i, 1, 0) for i in range(8)]
    end = hold.day0() + 30 * 86400.0
    ev = hold.pack("elo-yes", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", hold.prints_for(end))
    diff = 60.0
    p_draw = 0.25 * math.exp(-abs(diff) / 400.0)
    p_home = (1.0 - p_draw) / (1.0 + 10 ** (-diff / 400.0))
    _trade, hand = hold.assert_book(choose, scores, ev, "H", p_home)
    short = scores[:7]
    if choose(ev, short) is not None:
        raise SystemExit("seven matches were enough")
    rich = hold.pack("elo-no", end, "HOT", "COLD", hold.rich_board(0.80, 1.0, end), None, None)
    if choose(rich, scores) is not None or hold.trades_from([rich], scores, choose)[0]:
        raise SystemExit("a rich screen was bought")
    bad = hold.pack("elo-cut", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", "incomplete")
    _trades, _counts, inc = hold.trades_from([bad], scores, choose)
    if inc != 1 or post.evaluate([], inc)["passes"]:
        raise SystemExit("incomplete tape passed")
    print("self-check ok", "H", round(p_home, 6), round(hand, 6))


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
