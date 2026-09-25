"""WALK: buy the team whose starter walks 1.5 fewer per nine over six starts (fp5).

The contract is the full-time win. Not ARM. `--self-check` does not read a file.

usage: walk_test.py --self-check
       walk_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import mlb_score as mlb
import post_test as post

RULE = "WALK"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-walk.md"
N = 6
GAP = 1.5
MINIMUM = 8


def choose(ev, book):
    return mlb.walk_quote(ev, book, n=N, gap=GAP, minimum=MINIMUM)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _start(pid, day, bb):
    return {"pid": pid, "ts": hold.day0() + day * 86400.0, "outs": 27, "er": 0, "k": 0, "bb": bb, "pitches": 80}


def _book(home_bb, away_bb, home_wins):
    starts, games = [], []
    for i in range(6):
        starts.append(_start(1, -12 + i, home_bb))
        starts.append(_start(2, -12 + i, away_bb))
    for i in range(8):
        games.append({
            "ts": hold.day0() + i * 86400.0, "home": "HOT", "away": "COLD",
            "hr": 1 if home_wins else 0, "ar": 0 if home_wins else 1, "hp": 1, "ap": 2,
        })
        starts.append(_start(1, i, home_bb))
        starts.append(_start(2, i, away_bb))
    return {"games": games, "starts": starts}


def _event(end, side):
    markets = {
        "HOT": hold.market("HOT", 0.40 if side == "HOT" else 0.80, payout=1.0 if side == "HOT" else 0.0, end=end),
        "COLD": hold.market("COLD", 0.40 if side == "COLD" else 0.80, payout=1.0 if side == "COLD" else 0.0, end=end),
    }
    ev = hold.pack("walk-%s" % side, end, "HOT", "COLD", markets, side, hold.prints_for(end))
    ev["kind"] = "ml"
    ev["hp"], ev["ap"] = 1, 2
    return ev


def self_check():
    end = hold.day0() + 40 * 86400.0
    _trade, hand = hold.assert_book(choose, _book(1, 4, True), _event(end, "HOT"), "HOT", 1.0)
    if choose(_event(end, "HOT"), _book(2, 3, True)) is not None:
        raise SystemExit("a one-walk gap traded")
    hold.assert_book(choose, _book(4, 1, False), _event(end, "COLD"), "COLD", 1.0)
    broken = _event(end, "HOT")
    broken["picked"] = dict(broken["picked"])
    broken["picked"]["prints"] = "incomplete"
    _trades, _counts, inc = hold.trades_from([broken], _book(1, 4, True), choose)
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
