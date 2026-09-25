"""SPREAD15: buy a full-time -1.5 cover from that club's rate of winning by two or more (fp5).

An equal edge keeps the home club. Not MARGIN: this is the handicap contract,
and the fair value is the club's own rate, not a goal-difference gap on the
moneyline. `--self-check` does not read a file.

usage: spread15_test.py --self-check
       spread15_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import stat_score as stat

RULE = "SPREAD15"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-spread15.md"
MARGIN = 2
MINIMUM = 8


def choose(ev, scores):
    return stat.spread_quote(ev, scores, margin=MARGIN, minimum=MINIMUM)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _pack(end, side):
    markets = {
        "HOT": hold.market("HOT", 0.40, payout=1.0 if side == "HOT" else 0.0, end=end),
        "COLD": hold.market("COLD", 0.40, payout=1.0 if side == "COLD" else 0.0, end=end),
    }
    ev = hold.pack("spread-yes", end, "HOT", "COLD", markets, side, hold.prints_for(end))
    ev["kind"] = "spread"
    return ev


def self_check():
    score.assert_names()
    scores = []
    for i in range(8):
        scores.append(hold.played(i, "HOT", "P%d" % i, 3, 0))
        scores.append(hold.played(i + 0.2, "COLD", "Q%d" % i, 3, 0))
    end = hold.day0() + 40 * 86400.0
    ev = _pack(end, "HOT")
    _trade, hand = hold.assert_book(choose, scores, ev, "HOT", 1.0)
    if choose(ev, scores[:14]) is not None:
        raise SystemExit("seven games traded")
    away_scores = []
    for i in range(8):
        away_scores.append(hold.played(i, "HOT", "P%d" % i, 1, 0))
        away_scores.append(hold.played(i + 0.2, "COLD", "Q%d" % i, 3, 0))
    away = _pack(end, "COLD")
    hold.assert_book(choose, away_scores, away, "COLD", 1.0)
    ml = dict(ev)
    ml["kind"] = "ml"
    if choose(ml, scores) is not None:
        raise SystemExit("a moneyline traded as a spread")
    print("self-check ok", "HOT", round(1.0, 6), round(hand, 6))


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
