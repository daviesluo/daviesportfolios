"""XIN: buy extra innings when both clubs reach them (fp5).

The fair value is the average of the two clubs' own rates over the last 40
games, and only once each has 20. Not a run total. `--self-check` does not
read a file.

usage: xin_test.py --self-check
       xin_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import mlb_score as mlb
import post_test as post

RULE = "XIN"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-xin.md"
N = 40
MINIMUM = 20


def choose(ev, book):
    return mlb.xin_quote(ev, book, n=N, minimum=MINIMUM)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _book(n_games, extra):
    games = []
    for i in range(n_games):
        games.append({
            "ts": hold.day0() + i * 86400.0, "home": "HOT", "away": "COLD",
            "hr": 1, "ar": 0, "extra": extra,
        })
    return {"games": games, "starts": []}


def _event(end, side):
    markets = {
        "Y": hold.market("Y", 0.40 if side == "Y" else 0.80, payout=1.0 if side == "Y" else 0.0, end=end),
        "N": hold.market("N", 0.40 if side == "N" else 0.80, payout=1.0 if side == "N" else 0.0, end=end),
    }
    ev = hold.pack("xin-%s" % side, end, "HOT", "COLD", markets, side, hold.prints_for(end))
    ev["kind"] = "xin"
    return ev


def self_check():
    end = hold.day0() + 80 * 86400.0
    _trade, hand = hold.assert_book(choose, _book(20, 1), _event(end, "Y"), "Y", 1.0)
    if choose(_event(end, "Y"), _book(19, 1)) is not None:
        raise SystemExit("nineteen games traded")
    other = _event(end, "Y")
    other["kind"] = "ml"
    if choose(other, _book(20, 1)) is not None:
        raise SystemExit("a moneyline was quoted as extra innings")
    broken = _event(end, "Y")
    broken["picked"] = dict(broken["picked"])
    broken["picked"]["prints"] = "incomplete"
    _trades, _counts, inc = hold.trades_from([broken], _book(20, 1), choose)
    if inc != 1 or post.evaluate(_trades, inc)["passes"]:
        raise SystemExit("incomplete tape passed")
    print("self-check ok", "Y", round(1.0, 6), round(hand, 6))


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
