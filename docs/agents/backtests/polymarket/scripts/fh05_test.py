"""FH05: buy the first-half over 0.5 when a first-half goal is the clubs' habit (fp5).

The fair value is the average of the two rates. Not OVER35: that is four
full-time goals. A 1.5 first-half line is not this rule. `--self-check` does
not read a file.

usage: fh05_test.py --self-check
       fh05_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import half_score as half

RULE = "FH05"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-fh05.md"
MINIMUM = 8


def choose(ev, scores):
    return half.fh_quote(ev, scores, minimum=MINIMUM)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _fh(day, hthg, htag):
    row = hold.played(day, "HOT", "COLD", hthg, htag)
    row["hthg"] = hthg
    row["htag"] = htag
    return row


def _pack(end, line):
    markets = {"Y": hold.market("Y", 0.40, payout=1.0, end=end)}
    ev = hold.pack("fh-yes", end, "HOT", "COLD", markets, "Y", hold.prints_for(end))
    ev["kind"] = "fh"
    ev["line"] = line
    return ev


def self_check():
    score.assert_names()
    scored = [_fh(i, 1, 0) for i in range(8)]
    end = hold.day0() + 40 * 86400.0
    ev = _pack(end, 0.5)
    _trade, hand = hold.assert_book(choose, scored, ev, "Y", 1.0)
    blank = [_fh(i, 0, 0) for i in range(8)]
    if choose(ev, blank) is not None:
        raise SystemExit("a goalless first half was bought")
    other = _pack(end, 1.5)
    if choose(other, scored) is not None:
        raise SystemExit("a 1.5 line traded")
    if choose(ev, scored[:7]) is not None:
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
