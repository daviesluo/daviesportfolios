"""FOUL: buy the side that fouls two fewer times per game over its last six (fp5).

The fair value is how often that side then won. The side that fouls more is
not bought. `--self-check` does not read a file.

usage: foul_test.py --self-check
       foul_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import stat_score as stat

RULE = "FOUL"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-foul.md"
N = 6
GAP = 2.0
MINIMUM = 8


def choose(ev, scores):
    return stat.gap_quote(ev, scores, n=N, gap=GAP, minimum=MINIMUM, home_key="hf", away_key="af", higher=False)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _foul(day, home, away, hg, ag, hf, af):
    row = hold.played(day, home, away, hg, ag)
    row["hf"] = hf
    row["af"] = af
    return row


def self_check():
    score.assert_names()
    games = {"HOT": [], "COLD": []}
    for _i in range(6):
        games["HOT"].append({"home": "HOT", "away": "X", "hf": 1, "af": 0})
        games["COLD"].append({"home": "Y", "away": "COLD", "hf": 0, "af": 3})
    if stat._gap_side("HOT", "COLD", games, N, GAP, "hf", "af", False) != "H":
        raise SystemExit("a two-foul gap did not name the cleaner side")
    for row in games["HOT"]:
        row["hf"] = 2
    if stat._gap_side("HOT", "COLD", games, N, GAP, "hf", "af", False) is not None:
        raise SystemExit("a one-foul gap traded")
    scores = []
    for i in range(6):
        scores.append(_foul(i, "HOT", "P%d" % i, 1, 0, 1, 8))
        scores.append(_foul(i + 0.2, "Q%d" % i, "COLD", 0, 1, 1, 8))
    for i in range(8):
        scores.append(_foul(20 + i, "HOT", "COLD", 1, 0, 1, 8))
    end = hold.day0() + 40 * 86400.0
    ev = hold.pack("foul-yes", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", hold.prints_for(end))
    ev["kind"] = "ml"
    _trade, hand = hold.assert_book(choose, scores, ev, "H", 1.0)
    swapped = []
    for i in range(6):
        swapped.append(_foul(i, "HOT", "P%d" % i, 1, 0, 8, 1))
        swapped.append(_foul(i + 0.2, "Q%d" % i, "COLD", 1, 0, 8, 1))
    for i in range(8):
        swapped.append(_foul(20 + i, "HOT", "COLD", 0, 1, 8, 1))
    away_markets = {
        "H": hold.market("H", 0.80, payout=0.0, end=end),
        "D": hold.market("D", 0.80, payout=0.0, end=end),
        "A": hold.market("A", 0.40, payout=1.0, end=end),
    }
    away = hold.pack("foul-away", end, "HOT", "COLD", away_markets, "A", hold.prints_for(end))
    away["kind"] = "ml"
    hold.assert_book(choose, swapped, away, "A", 1.0)
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
