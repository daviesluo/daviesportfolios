"""FORM5: buy the side ahead by 0.6 points per game over its last five (fp5).

The fair value is how often that side then won. A smaller gap is no trade.
Not ELO: the other matches do not move a rating. `--self-check` does not read a file.

usage: form_test.py --self-check
       form_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score

RULE = "FORM5"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-form5.md"


def choose(ev, scores):
    return score.form_quote(ev, scores, n=5, gap=0.6, minimum=8)


def _scores():
    scores = []
    for i in range(5):
        scores.append(hold.played(i * 2, "HOT", "P%d" % i, 1, 0))
        scores.append(hold.played(i * 2 + 1, "Q%d" % i, "COLD", 1, 0))
    for i in range(8):
        scores.append(hold.played(12 + i, "HOT", "COLD", 1, 0))
    return scores


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def self_check():
    score.assert_names()
    scores = _scores()
    end = hold.day0() + 30 * 86400.0
    ev = hold.pack("form-yes", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", hold.prints_for(end))
    _trade, hand = hold.assert_book(choose, scores, ev, "H", 1.0)
    flat = list(scores)
    for i in range(5):
        flat.append(hold.played(21 + i, "HOT", "R%d" % i, 1, 0))
        flat.append(hold.played(21 + i, "COLD", "S%d" % i, 1, 0))
    level = hold.pack("form-flat", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), None, None)
    if choose(level, flat) is not None:
        raise SystemExit("level form was traded")
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
