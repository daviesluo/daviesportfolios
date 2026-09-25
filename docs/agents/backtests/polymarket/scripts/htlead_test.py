"""HTLEAD: buy the club that leads at halftime more often (fp5).

The contract is "leading at halftime", not the full-time win. Eight prior
matches. The draw is not bought. `--self-check` does not read a file.

usage: htlead_test.py --self-check
       htlead_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import half_score as half
import post_test as post

RULE = "HTLEAD"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-htlead.md"
MINIMUM = 8


def choose(ev, scores):
    return half.htlead_quote(ev, scores, minimum=MINIMUM)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _led(day, home, away, htr):
    hg, ag = (1, 0) if htr == "H" else ((0, 1) if htr == "A" else (0, 0))
    row = hold.played(day, home, away, hg, ag)
    row["htr"] = htr
    row["hthg"] = hg
    row["htag"] = ag
    return row


def _board(end, side):
    return {
        "HOT": hold.market("HOT", 0.40, payout=1.0 if side == "HOT" else 0.0, end=end),
        "COLD": hold.market("COLD", 0.40, payout=1.0 if side == "COLD" else 0.0, end=end),
    }


def self_check():
    score.assert_names()
    home_scores = [_led(i, "HOT", "COLD", "H") for i in range(8)]
    end = hold.day0() + 40 * 86400.0
    ev = hold.pack("htlead-yes", end, "HOT", "COLD", _board(end, "HOT"), "HOT", hold.prints_for(end))
    ev["kind"] = "ht"
    _trade, hand = hold.assert_book(choose, home_scores, ev, "HOT", 1.0)
    if choose(ev, home_scores[:7]) is not None:
        raise SystemExit("seven games traded")
    away_scores = [_led(i, "HOT", "COLD", "A") for i in range(8)]
    away = hold.pack("htlead-away", end, "HOT", "COLD", _board(end, "COLD"), "COLD", hold.prints_for(end))
    away["kind"] = "ht"
    hold.assert_book(choose, away_scores, away, "COLD", 1.0)
    ml = dict(ev)
    ml["kind"] = "ml"
    if choose(ml, home_scores) is not None:
        raise SystemExit("a moneyline traded as a halftime lead")
    broken = dict(ev)
    broken["slug"] = "htlead-incomplete"
    broken["picked"] = dict(ev["picked"])
    broken["picked"]["prints"] = "incomplete"
    _trades, _counts, inc = hold.trades_from([broken], home_scores, choose)
    if inc != 1 or post.evaluate(_trades, inc)["passes"]:
        raise SystemExit("incomplete tape passed")
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
