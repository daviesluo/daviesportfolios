"""SHWIN: buy the side that scores half a goal more after the break (fp5).

The count is full-time goals minus halftime goals, over the last six matches.
The contract is the full-time win. Not a second-half result market, and not
OVER35. `--self-check` does not read a file.

usage: shwin_test.py --self-check
       shwin_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import stat_score as stat

RULE = "SHWIN"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-shwin.md"
N = 6
GAP = 0.5
MINIMUM = 8


def choose(ev, scores):
    return stat.gap_quote(ev, scores, n=N, gap=GAP, minimum=MINIMUM, home_key="hsh", away_key="ash", higher=True)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _half(day, home, away, hg, ag, hsh, ash):
    row = hold.played(day, home, away, hg, ag)
    row["hsh"] = hsh
    row["ash"] = ash
    return row


def self_check():
    score.assert_names()
    games = {"HOT": [], "COLD": []}
    for _i in range(6):
        games["HOT"].append({"home": "HOT", "away": "X", "hsh": 1, "ash": 0})
        games["COLD"].append({"home": "Y", "away": "COLD", "hsh": 0, "ash": 0})
    if stat._gap_side("HOT", "COLD", games, N, GAP, "hsh", "ash", True) != "H":
        raise SystemExit("half a goal did not name the home side")
    for row in games["COLD"]:
        row["ash"] = 1
    if stat._gap_side("HOT", "COLD", games, N, GAP, "hsh", "ash", True) is not None:
        raise SystemExit("an even second half traded")
    scores = []
    for i in range(6):
        scores.append(_half(i, "HOT", "P%d" % i, 2, 0, 2, 0))
        scores.append(_half(i + 0.2, "Q%d" % i, "COLD", 1, 0, 0, 0))
    for i in range(8):
        scores.append(_half(20 + i, "HOT", "COLD", 2, 0, 2, 0))
    end = hold.day0() + 40 * 86400.0
    ev = hold.pack("shwin-yes", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", hold.prints_for(end))
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
