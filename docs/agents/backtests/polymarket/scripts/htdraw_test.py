"""HTDRAW: buy the halftime draw from the two clubs' own rates (fp5).

Not DRAWBASE: that is the league's full-time draw. Not BTTS. Eight prior
matches each. `--self-check` does not read a file.

usage: htdraw_test.py --self-check
       htdraw_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import half_score as half

RULE = "HTDRAW"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-htdraw.md"
MINIMUM = 8


def choose(ev, scores):
    return half.htdraw_quote(ev, scores, minimum=MINIMUM)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _level(day, htr):
    row = hold.played(day, "HOT", "COLD", 0, 0)
    row["htr"] = htr
    row["hthg"] = 0
    row["htag"] = 0
    return row


def self_check():
    score.assert_names()
    drawn = [_level(i, "D") for i in range(8)]
    end = hold.day0() + 40 * 86400.0
    markets = {"D": hold.market("D", 0.40, payout=1.0, end=end)}
    ev = hold.pack("htdraw-yes", end, "HOT", "COLD", markets, "D", hold.prints_for(end))
    ev["kind"] = "ht"
    _trade, hand = hold.assert_book(choose, drawn, ev, "D", 1.0)
    led = [_level(i, "H") for i in range(8)]
    for row in led:
        row["htr"] = "H"
    if choose(ev, led) is not None:
        raise SystemExit("a half with a leader was bought as a draw")
    if choose(ev, drawn[:7]) is not None:
        raise SystemExit("seven games traded")
    print("self-check ok", "D", round(1.0, 6), round(hand, 6))


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
