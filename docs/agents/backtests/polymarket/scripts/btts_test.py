"""BTTS: buy both-teams-to-score when the two clubs' rates clear the price (fp5).

The fair value is the average of the two rates. The no side is not bought.
`--self-check` does not read a file.

usage: btts_test.py --self-check
       btts_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import stat_score as stat

RULE = "BTTS"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-btts.md"
MINIMUM = 8


def choose(ev, scores):
    return stat.btts_quote(ev, scores, minimum=MINIMUM)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _pack(end, payout):
    markets = {"Y": hold.market("Y", 0.40, payout=payout, end=end)}
    ev = hold.pack("btts-yes", end, "HOT", "COLD", markets, "Y", hold.prints_for(end))
    ev["kind"] = "btts"
    return ev


def self_check():
    score.assert_names()
    both = []
    for i in range(8):
        both.append(hold.played(i, "HOT", "COLD", 2, 1))
    end = hold.day0() + 40 * 86400.0
    ev = _pack(end, 1.0)
    _trade, hand = hold.assert_book(choose, both, ev, "Y", 1.0)
    blank = [hold.played(i, "HOT", "COLD", 1, 0) for i in range(8)]
    if choose(ev, blank) is not None:
        raise SystemExit("a match with one scorer was bought")
    if choose(ev, both[:7]) is not None:
        raise SystemExit("seven games traded")
    print("self-check ok", "Y", round(1.0, 6), round(hand, 6))


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
