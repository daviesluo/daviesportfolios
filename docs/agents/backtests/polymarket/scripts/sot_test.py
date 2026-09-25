"""SOT: buy the side ahead by 1.5 shots on target per game over its last six (fp5).

The fair value is how often that side then won. Not FORM5: shots, not points.
`--self-check` does not read a file.

usage: sot_test.py --self-check
       sot_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import stat_score as stat

RULE = "SOT"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-sot.md"
N = 6
GAP = 1.5
MINIMUM = 8


def choose(ev, scores):
    return stat.gap_quote(ev, scores, n=N, gap=GAP, minimum=MINIMUM, home_key="hst", away_key="ast", higher=True)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _shot(day, home, away, hg, ag, hst, ast):
    row = hold.played(day, home, away, hg, ag)
    row["hst"] = hst
    row["ast"] = ast
    return row


def _book(end, side):
    if side == "H":
        markets = hold.rich_board(0.40, 1.0, end)
    else:
        markets = {
            "H": hold.market("H", 0.80, payout=0.0, end=end),
            "D": hold.market("D", 0.80, payout=0.0, end=end),
            "A": hold.market("A", 0.40, payout=1.0, end=end),
        }
    return markets


def self_check():
    score.assert_names()
    games = {"HOT": [], "COLD": []}
    for i in range(6):
        games["HOT"].append({"home": "HOT", "away": "X", "hst": 3, "ast": 0})
        games["COLD"].append({"home": "Y", "away": "COLD", "hst": 0, "ast": 1})
    if stat._gap_side("HOT", "COLD", games, N, GAP, "hst", "ast", True) != "H":
        raise SystemExit("a 1.5 shot gap did not name the home side")
    for row in games["HOT"]:
        row["hst"] = 2
    if stat._gap_side("HOT", "COLD", games, N, GAP, "hst", "ast", True) is not None:
        raise SystemExit("a one-shot gap traded")
    scores = []
    for i in range(6):
        scores.append(_shot(i, "HOT", "P%d" % i, 1, 0, 6, 0))
        scores.append(_shot(i + 0.2, "Q%d" % i, "COLD", 1, 0, 6, 0))
    for i in range(8):
        scores.append(_shot(20 + i, "HOT", "COLD", 2, 0, 6, 0))
    end = hold.day0() + 40 * 86400.0
    ev = hold.pack("sot-yes", end, "HOT", "COLD", _book(end, "H"), "H", hold.prints_for(end))
    ev["kind"] = "ml"
    _trade, hand = hold.assert_book(choose, scores, ev, "H", 1.0)
    flat = []
    for i in range(6):
        flat.append(_shot(i, "HOT", "P%d" % i, 1, 0, 3, 3))
        flat.append(_shot(i + 0.2, "Q%d" % i, "COLD", 1, 0, 3, 3))
    for i in range(8):
        flat.append(_shot(20 + i, "HOT", "COLD", 1, 0, 3, 3))
    if choose(ev, flat) is not None:
        raise SystemExit("a flat shot gap traded")
    away_scores = []
    for i in range(6):
        away_scores.append(_shot(i, "COLD", "R%d" % i, 1, 0, 0, 0))
        away_scores.append(_shot(i + 0.2, "Q%d" % i, "HOT", 0, 1, 0, 6))
    for i in range(8):
        away_scores.append(_shot(20 + i, "COLD", "HOT", 0, 1, 0, 6))
    away = hold.pack("sot-away", end, "COLD", "HOT", _book(end, "A"), "A", hold.prints_for(end))
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
