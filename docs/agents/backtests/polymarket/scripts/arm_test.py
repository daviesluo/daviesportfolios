"""ARM: buy the team whose starter has a 1.5 lower ERA over six starts (fp5).

The contract is the full-time win. Not FORM5. Not a run line. `--self-check`
does not read a file.

usage: arm_test.py --self-check
       arm_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import mlb_score as mlb
import post_test as post

RULE = "ARM"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-arm.md"
N = 6
GAP = 1.5
MINIMUM = 8


def choose(ev, book):
    return mlb.arm_quote(ev, book, n=N, gap=GAP, minimum=MINIMUM)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _start(pid, day, er):
    return {"pid": pid, "ts": hold.day0() + day * 86400.0, "outs": 27, "er": er, "k": 0, "bb": 0, "pitches": 80}


def _game(day, hr, ar):
    row = {"ts": hold.day0() + day * 86400.0, "home": "HOT", "away": "COLD", "hr": hr, "ar": ar, "hp": 1, "ap": 2}
    return row


def _book(home_er, away_er):
    starts = []
    games = []
    for i in range(6):
        starts.append(_start(1, -12 + i, home_er))
        starts.append(_start(2, -12 + i, away_er))
    for i in range(8):
        games.append(_game(i, 1, 0))
        starts.append(_start(1, i, home_er))
        starts.append(_start(2, i, away_er))
    return {"games": games, "starts": starts}


def _event(end, home_er_side):
    markets = {
        "HOT": hold.market("HOT", 0.40 if home_er_side == "HOT" else 0.80, payout=1.0 if home_er_side == "HOT" else 0.0, end=end),
        "COLD": hold.market("COLD", 0.40 if home_er_side == "COLD" else 0.80, payout=1.0 if home_er_side == "COLD" else 0.0, end=end),
    }
    ev = hold.pack("arm-%s" % home_er_side, end, "HOT", "COLD", markets, home_er_side, hold.prints_for(end))
    ev["kind"] = "ml"
    ev["hp"] = 1 if home_er_side == "HOT" else 2
    ev["ap"] = 2 if home_er_side == "HOT" else 1
    return ev


def self_check():
    end = hold.day0() + 40 * 86400.0
    book = _book(0, 6)
    ev = _event(end, "HOT")
    _trade, hand = hold.assert_book(choose, book, ev, "HOT", 1.0)
    if choose(_event(end, "HOT"), {"games": book["games"][:7], "starts": book["starts"]}) is not None:
        raise SystemExit("seven games traded")
    away_games = []
    starts = []
    for i in range(6):
        starts.append(_start(1, -12 + i, 6))
        starts.append(_start(2, -12 + i, 0))
    for i in range(8):
        away_games.append({"ts": hold.day0() + i * 86400.0, "home": "HOT", "away": "COLD", "hr": 0, "ar": 1, "hp": 1, "ap": 2})
        starts.append(_start(1, i, 6))
        starts.append(_start(2, i, 0))
    away = _event(end, "COLD")
    away["hp"], away["ap"] = 1, 2
    hold.assert_book(choose, {"games": away_games, "starts": starts}, away, "COLD", 1.0)
    narrow = _book(3, 4)
    if choose(_event(end, "HOT"), narrow) is not None:
        raise SystemExit("a one-run ERA gap traded")
    broken = dict(ev)
    broken["slug"] = "arm-incomplete"
    broken["picked"] = dict(ev["picked"])
    broken["picked"]["prints"] = "incomplete"
    _trades, _counts, inc = hold.trades_from([broken], book, choose)
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
