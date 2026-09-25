"""H2H: buy the modal result of these two clubs, seen from today's home side (fp5).

Three prior meetings are required. A tie between two results is no trade.
A reversed fixture counts for the club that won it, not for the stadium.
`--self-check` does not read a file.

usage: h2h_test.py --self-check
       h2h_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score

RULE = "H2H"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-h2h.md"


def choose(ev, scores):
    return score.h2h_quote(ev, scores, minimum=3)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def self_check():
    score.assert_names()
    scores = [
        hold.played(1, "HOT", "COLD", 1, 0),
        hold.played(10, "COLD", "HOT", 0, 1),
        hold.played(20, "HOT", "COLD", 2, 0),
    ]
    end = hold.day0() + 40 * 86400.0
    ev = hold.pack("h2h-yes", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", hold.prints_for(end))
    _trade, hand = hold.assert_book(choose, scores, ev, "H", 1.0)
    tied = [
        hold.played(1, "HOT", "COLD", 1, 0),
        hold.played(5, "HOT", "COLD", 0, 1),
        hold.played(10, "COLD", "HOT", 1, 0),
        hold.played(15, "COLD", "HOT", 0, 1),
    ]
    no = hold.pack("h2h-tie", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), None, None)
    if choose(no, tied) is not None:
        raise SystemExit("a split pair was traded")
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
