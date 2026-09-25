"""HTWIN: buy the side that led at the break two more times in its last six (fp5).

The contract is the full-time win. The fair value is how often that side then
won. Not HTLEAD, which buys the halftime-lead contract itself. `--self-check`
does not read a file.

usage: htwin_test.py --self-check
       htwin_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import stat_score as stat

RULE = "HTWIN"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-htwin.md"
N = 6
GAP = 2 / 6
MINIMUM = 8


def choose(ev, scores):
    return stat.gap_quote(ev, scores, n=N, gap=GAP, minimum=MINIMUM, home_key="hld", away_key="ald", higher=True)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _lead(day, home, away, hg, ag, hld, ald):
    row = hold.played(day, home, away, hg, ag)
    row["hld"] = hld
    row["ald"] = ald
    return row


def self_check():
    score.assert_names()
    games = {"HOT": [], "COLD": []}
    for _i in range(6):
        games["HOT"].append({"home": "HOT", "away": "X", "hld": 1, "ald": 0})
        games["COLD"].append({"home": "Y", "away": "COLD", "hld": 0, "ald": 0})
    if stat._gap_side("HOT", "COLD", games, N, GAP, "hld", "ald", True) != "H":
        raise SystemExit("two extra halftime leads did not name the home side")
    for row in games["HOT"]:
        row["hld"] = 0
    games["HOT"][0]["hld"] = 1
    if stat._gap_side("HOT", "COLD", games, N, GAP, "hld", "ald", True) is not None:
        raise SystemExit("one halftime lead traded")
    scores = []
    for i in range(6):
        scores.append(_lead(i, "HOT", "P%d" % i, 1, 0, 1, 0))
        scores.append(_lead(i + 0.2, "Q%d" % i, "COLD", 1, 0, 0, 0))
    for i in range(8):
        scores.append(_lead(20 + i, "HOT", "COLD", 1, 0, 1, 0))
    end = hold.day0() + 40 * 86400.0
    ev = hold.pack("htwin-yes", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", hold.prints_for(end))
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
