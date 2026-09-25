"""STREAK3: buy the side that won its last three when the other side did not (fp5).

The fair value is how often that side then won. Both on a run, or neither,
is no trade. Not FORM5: three wins, not a points rate. `--self-check` does
not read a file.

usage: streak_test.py --self-check
       streak_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score

RULE = "STREAK3"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-streak3.md"


def choose(ev, scores):
    return score.streak_quote(ev, scores, n=3, minimum=8)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def self_check():
    score.assert_names()
    scores = []
    for i in range(5):
        scores.append(hold.played(i * 2, "HOT", "P%d" % i, 1, 0))
        scores.append(hold.played(i * 2 + 1, "Q%d" % i, "COLD", 1, 0))
    for i in range(8):
        scores.append(hold.played(12 + i, "HOT", "COLD", 1, 0))
    end = hold.day0() + 30 * 86400.0
    ev = hold.pack("streak-yes", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", hold.prints_for(end))
    _trade, hand = hold.assert_book(choose, scores, ev, "H", 1.0)
    both = list(scores)
    for i in range(3):
        both.append(hold.played(22 + i, "COLD", "S%d" % i, 1, 0))
    twin = hold.pack("streak-both", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), None, None)
    if choose(twin, both) is not None:
        raise SystemExit("two streaks were traded")
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
