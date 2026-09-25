"""TEAM15: buy a club's full-time over 1.5 from its own rate of scoring twice (fp5).

Not SPREAD15: scoring twice is not winning by two. An equal edge keeps the
home club. `--self-check` does not read a file.

usage: team15_test.py --self-check
       team15_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import half_score as half

RULE = "TEAM15"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-team15.md"
GOALS = 2
MINIMUM = 8


def choose(ev, scores):
    return half.team_quote(ev, scores, goals=GOALS, minimum=MINIMUM)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _pack(end, side, line):
    markets = {
        "HOT": hold.market("HOT", 0.40, payout=1.0 if side == "HOT" else 0.0, end=end),
        "COLD": hold.market("COLD", 0.40, payout=1.0 if side == "COLD" else 0.0, end=end),
    }
    ev = hold.pack("team-yes", end, "HOT", "COLD", markets, side, hold.prints_for(end))
    ev["kind"] = "team"
    ev["line"] = line
    return ev


def self_check():
    score.assert_names()
    both = []
    for i in range(8):
        both.append(hold.played(i, "HOT", "P%d" % i, 3, 0))
        both.append(hold.played(i + 0.2, "COLD", "Q%d" % i, 3, 0))
    end = hold.day0() + 40 * 86400.0
    ev = _pack(end, "HOT", 1.5)
    _trade, hand = hold.assert_book(choose, both, ev, "HOT", 1.0)
    if choose(ev, both[:14]) is not None:
        raise SystemExit("seven games traded")
    away_scores = []
    for i in range(8):
        away_scores.append(hold.played(i, "HOT", "P%d" % i, 1, 0))
        away_scores.append(hold.played(i + 0.2, "COLD", "Q%d" % i, 3, 0))
    away = _pack(end, "COLD", 1.5)
    hold.assert_book(choose, away_scores, away, "COLD", 1.0)
    other = _pack(end, "HOT", 0.5)
    if choose(other, both) is not None:
        raise SystemExit("a 0.5 team total traded")
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
