"""CLEAN: buy the side with two more clean sheets in its last six (fp5).

A clean sheet is conceding no goal. The contract is the full-time win. The
fair value is how often that side then won. Not FOUL. `--self-check` does not
read a file.

usage: clean_test.py --self-check
       clean_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import stat_score as stat

RULE = "CLEAN"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-clean.md"
N = 6
GAP = 2 / 6
MINIMUM = 8


def choose(ev, scores):
    return stat.gap_quote(ev, scores, n=N, gap=GAP, minimum=MINIMUM, home_key="hcl", away_key="acl", higher=True)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _sheet(day, home, away, hg, ag, hcl, acl):
    row = hold.played(day, home, away, hg, ag)
    row["hcl"] = hcl
    row["acl"] = acl
    return row


def self_check():
    score.assert_names()
    games = {"HOT": [], "COLD": []}
    for _i in range(6):
        games["HOT"].append({"home": "HOT", "away": "X", "hcl": 1, "acl": 0})
        games["COLD"].append({"home": "Y", "away": "COLD", "hcl": 0, "acl": 0})
    if stat._gap_side("HOT", "COLD", games, N, GAP, "hcl", "acl", True) != "H":
        raise SystemExit("two extra clean sheets did not name the home side")
    for row in games["HOT"]:
        row["hcl"] = 0
    games["HOT"][0]["hcl"] = 1
    if stat._gap_side("HOT", "COLD", games, N, GAP, "hcl", "acl", True) is not None:
        raise SystemExit("one clean sheet traded")
    scores = []
    for i in range(6):
        scores.append(_sheet(i, "HOT", "P%d" % i, 1, 0, 1, 0))
        scores.append(_sheet(i + 0.2, "Q%d" % i, "COLD", 1, 0, 0, 0))
    for i in range(8):
        scores.append(_sheet(20 + i, "HOT", "COLD", 1, 0, 1, 0))
    end = hold.day0() + 40 * 86400.0
    ev = hold.pack("clean-yes", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", hold.prints_for(end))
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
