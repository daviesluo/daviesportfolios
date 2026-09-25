"""TABLE: buy the side leading this season's table by three points (fp5).

Both clubs have played at least four league games. The fair value is how
often that lead then won. Last season's points do not carry. Not FORM5:
the window is the season, and the unit is points, not a five-game rate.
`--self-check` does not read a file.

usage: table_test.py --self-check
       table_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys
from collections import defaultdict

import epl_hold as hold
import epl_score as score

RULE = "TABLE"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-table.md"


def choose(ev, scores):
    return score.table_quote(ev, scores, games_min=4, gap=3, minimum=8)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def self_check():
    score.assert_names()
    scores = []
    for i in range(5):
        scores.append(hold.played(i * 2, "HOT", "P%d" % i, 1, 0))
        scores.append(hold.played(i * 2 + 1, "Q%d" % i, "COLD", 1, 0))
    for i in range(8):
        scores.append(hold.played(12 + i, "HOT", "COLD", 1, 0))
    end = hold.day0() + 30 * 86400.0
    ev = hold.pack("table-yes", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", hold.prints_for(end))
    _trade, hand = hold.assert_book(choose, scores, ev, "H", 1.0)
    games = defaultdict(list)
    games["HOT"] = [hold.played(-50, "HOT", "Z", 3, 0), hold.played(1, "HOT", "Y", 1, 1)]
    pts, played = score._table_points("HOT", games, score.season_of(end))
    if played != 1 or pts != 1:
        raise SystemExit("last season's points counted %s %s" % (pts, played))
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
