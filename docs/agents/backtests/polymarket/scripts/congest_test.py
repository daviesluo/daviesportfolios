"""CONGEST: buy the side with at least two fewer matches in the last 14 days (fp5).

The fair value is how often the less crowded side then won. Not REST:
a count in a window, not the gap since the previous kickoff.
`--self-check` does not read a file.

usage: congest_test.py --self-check
       congest_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score

RULE = "CONGEST"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-congest.md"


def choose(ev, scores):
    return score.congest_quote(ev, scores, days=14, gap=2, minimum=8)


def _scores():
    scores = []
    for i in range(8):
        base = i * 40
        scores.append(hold.played(base, "COLD", "N%d" % (i * 3), 1, 0))
        scores.append(hold.played(base + 3, "COLD", "N%d" % (i * 3 + 1), 1, 0))
        scores.append(hold.played(base + 6, "N%d" % (i * 3 + 2), "COLD", 1, 0))
        scores.append(hold.played(base + 10, "HOT", "COLD", 1, 0))
    scores.append(hold.played(330, "COLD", "Z0", 1, 0))
    scores.append(hold.played(333, "COLD", "Z1", 1, 0))
    scores.append(hold.played(336, "Z2", "COLD", 1, 0))
    return scores


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def self_check():
    score.assert_names()
    scores = _scores()
    end = hold.day0() + 340 * 86400.0
    ev = hold.pack("congest-yes", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", hold.prints_for(end))
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
