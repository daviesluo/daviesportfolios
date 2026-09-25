"""REST: buy the side with at least two more days since its previous match (fp5).

The fair value is how often the more rested side then won. Equal rest is
no trade. Not CONGEST: one previous kickoff, not a count of matches.
`--self-check` does not read a file.

usage: rest_test.py --self-check
       rest_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score

RULE = "REST"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-rest.md"


def choose(ev, scores):
    return score.rest_quote(ev, scores, gap_days=2.0, minimum=8)


def _scores():
    scores = []
    for i in range(8):
        base = i * 20
        scores.append(hold.played(base, "HOT", "F%d" % i, 1, 0))
        scores.append(hold.played(base + 9, "G%d" % i, "COLD", 1, 0))
        scores.append(hold.played(base + 10, "HOT", "COLD", 1, 0))
    scores.append(hold.played(160, "HOT", "FILL", 1, 0))
    scores.append(hold.played(169, "COLD", "FILL2", 0, 1))
    return scores


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def self_check():
    score.assert_names()
    scores = _scores()
    end = hold.day0() + 170 * 86400.0
    ev = hold.pack("rest-yes", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", hold.prints_for(end))
    _trade, hand = hold.assert_book(choose, scores, ev, "H", 1.0)
    even = list(scores)
    even.append(hold.played(169.5, "HOT", "N1", 1, 0))
    even.append(hold.played(169.5, "COLD", "N2", 1, 0))
    level = hold.pack("rest-even", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), None, None)
    if choose(level, even) is not None:
        raise SystemExit("equal rest was traded")
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
