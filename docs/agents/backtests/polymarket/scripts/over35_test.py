"""OVER35: buy the full-time over 3.5 from the two clubs' rates of four or more goals (fp5).

The under is not bought. A 2.5 line is not this rule. `--self-check` does not read a file.

usage: over35_test.py --self-check
       over35_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import stat_score as stat

RULE = "OVER35"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-over35.md"
GOALS = 4
MINIMUM = 8


def choose(ev, scores):
    return stat.over_quote(ev, scores, goals=GOALS, minimum=MINIMUM)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _pack(end, line):
    markets = {"Y": hold.market("Y", 0.40, payout=1.0, end=end)}
    ev = hold.pack("over-yes", end, "HOT", "COLD", markets, "Y", hold.prints_for(end))
    ev["kind"] = "over"
    ev["line"] = line
    return ev


def self_check():
    score.assert_names()
    high = [hold.played(i, "HOT", "COLD", 3, 1) for i in range(8)]
    end = hold.day0() + 40 * 86400.0
    ev = _pack(end, 3.5)
    _trade, hand = hold.assert_book(choose, high, ev, "Y", 1.0)
    low = [hold.played(i, "HOT", "COLD", 1, 0) for i in range(8)]
    if choose(ev, low) is not None:
        raise SystemExit("a one-goal match was bought as four")
    other = _pack(end, 2.5)
    if choose(other, high) is not None:
        raise SystemExit("a 2.5 line traded")
    if choose(ev, high[:7]) is not None:
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
