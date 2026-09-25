"""CARD: buy the side with 0.8 fewer yellow cards per game over its last six (fp5).

The fair value is how often that side then won. Red cards are not in the
count. `--self-check` does not read a file.

usage: card_test.py --self-check
       card_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import stat_score as stat

RULE = "CARD"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-card.md"
N = 6
GAP = 0.8
MINIMUM = 8


def choose(ev, scores):
    return stat.gap_quote(ev, scores, n=N, gap=GAP, minimum=MINIMUM, home_key="hy", away_key="ay", higher=False)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _card(day, home, away, hg, ag, hy, ay):
    row = hold.played(day, home, away, hg, ag)
    row["hy"] = hy
    row["ay"] = ay
    return row


def self_check():
    score.assert_names()
    games = {"HOT": [], "COLD": []}
    for _i in range(6):
        games["HOT"].append({"home": "HOT", "away": "X", "hy": 0, "ay": 0})
        games["COLD"].append({"home": "Y", "away": "COLD", "hy": 0, "ay": 1})
    if stat._gap_side("HOT", "COLD", games, N, GAP, "hy", "ay", False) != "H":
        raise SystemExit("a 0.8 yellow gap did not name the cleaner side")
    for row in games["COLD"]:
        row["ay"] = 0
    games["COLD"][-1]["ay"] = 4
    if stat._gap_side("HOT", "COLD", games, N, GAP, "hy", "ay", False) is not None:
        raise SystemExit("four yellows in six games traded")
    scores = []
    for i in range(6):
        scores.append(_card(i, "HOT", "P%d" % i, 1, 0, 0, 3))
        scores.append(_card(i + 0.2, "Q%d" % i, "COLD", 0, 1, 0, 3))
    for i in range(8):
        scores.append(_card(20 + i, "HOT", "COLD", 1, 0, 0, 3))
    end = hold.day0() + 40 * 86400.0
    ev = hold.pack("card-yes", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", hold.prints_for(end))
    ev["kind"] = "ml"
    _trade, hand = hold.assert_book(choose, scores, ev, "H", 1.0)
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
