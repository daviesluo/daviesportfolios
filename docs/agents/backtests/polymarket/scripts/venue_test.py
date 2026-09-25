"""VENUE: buy this club's home win when its own home win rate clears the screen (fp5).

Eight prior home games are required. Away games do not enter the rate.
The away market is not a second trade. `--self-check` does not read a file.

usage: venue_test.py --self-check
       venue_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score

RULE = "VENUE"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-venue.md"


def choose(ev, scores):
    return score.venue_quote(ev, scores, minimum=8)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def self_check():
    score.assert_names()
    scores = [hold.played(i, "HOT", "P%d" % i, 1, 0) for i in range(8)]
    scores.append(hold.played(9, "Q", "HOT", 1, 0))
    end = hold.day0() + 20 * 86400.0
    ev = hold.pack("venue-yes", end, "HOT", "COLD", hold.rich_board(0.40, 0.0, end), "H", hold.prints_for(end))
    _trade, hand = hold.assert_book(choose, scores, ev, "H", 1.0)
    if hand >= 0:
        raise SystemExit("a lost home was marked up")
    short = scores[:7]
    if choose(ev, short) is not None:
        raise SystemExit("seven homes were enough")
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
