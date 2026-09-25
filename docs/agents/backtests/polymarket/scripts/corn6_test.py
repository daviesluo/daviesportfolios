"""CORN6: buy the side with two more corners a game over its last six (fp5).

The contract is the full-time win. The fair value is how often that side then
won. Not CORNERS, which buys a corner total. Not SOT. `--self-check` does not
read a file.

usage: corn6_test.py --self-check
       corn6_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import stat_score as stat

RULE = "CORN6"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-corn6.md"
N = 6
GAP = 2.0
MINIMUM = 8


def choose(ev, scores):
    return stat.gap_quote(ev, scores, n=N, gap=GAP, minimum=MINIMUM, home_key="hc", away_key="ac", higher=True)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _corn(day, home, away, hg, ag, hc, ac):
    row = hold.played(day, home, away, hg, ag)
    row["hc"] = hc
    row["ac"] = ac
    return row


def self_check():
    score.assert_names()
    games = {"HOT": [], "COLD": []}
    for _i in range(6):
        games["HOT"].append({"home": "HOT", "away": "X", "hc": 6, "ac": 0})
        games["COLD"].append({"home": "Y", "away": "COLD", "hc": 0, "ac": 2})
    if stat._gap_side("HOT", "COLD", games, N, GAP, "hc", "ac", True) != "H":
        raise SystemExit("a two-corner gap did not name the home side")
    for row in games["HOT"]:
        row["hc"] = 3
    if stat._gap_side("HOT", "COLD", games, N, GAP, "hc", "ac", True) is not None:
        raise SystemExit("a one-corner gap traded")
    scores = []
    for i in range(6):
        scores.append(_corn(i, "HOT", "P%d" % i, 1, 0, 6, 0))
        scores.append(_corn(i + 0.2, "Q%d" % i, "COLD", 1, 0, 6, 2))
    for i in range(8):
        scores.append(_corn(20 + i, "HOT", "COLD", 1, 0, 6, 2))
    end = hold.day0() + 40 * 86400.0
    ev = hold.pack("corn6-yes", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", hold.prints_for(end))
    ev["kind"] = "ml"
    _trade, hand = hold.assert_book(choose, scores, ev, "H", 1.0)
    away_scores = []
    for i in range(6):
        away_scores.append(_corn(i, "COLD", "R%d" % i, 1, 0, 2, 0))
        away_scores.append(_corn(i + 0.2, "Q%d" % i, "HOT", 0, 1, 0, 6))
    for i in range(8):
        away_scores.append(_corn(20 + i, "COLD", "HOT", 0, 1, 0, 6))
    markets = {
        "H": hold.market("H", 0.80, payout=0.0, end=end),
        "D": hold.market("D", 0.80, payout=0.0, end=end),
        "A": hold.market("A", 0.40, payout=1.0, end=end),
    }
    away = hold.pack("corn6-away", end, "COLD", "HOT", markets, "A", hold.prints_for(end))
    away["kind"] = "ml"
    hold.assert_book(choose, away_scores, away, "A", 1.0)
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
