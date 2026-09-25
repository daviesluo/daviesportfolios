"""YRFI: buy a first-inning run when the two starters allow them (fp5).

The fair value is 1-(1-r1)*(1-r2). Not the average of the two rates. Not BTTS.
Not FH05. Not a full-game total. `--self-check` does not read a file.

usage: yrfi_test.py --self-check
       yrfi_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import mlb_score as mlb
import post_test as post

RULE = "YRFI"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-yrfi.md"
N = 10
MINIMUM = 8


def choose(ev, book):
    return mlb.yrfi_quote(ev, book, n=N, minimum=MINIMUM)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _start(pid, day, allowed):
    return {
        "pid": pid, "ts": hold.day0() + day * 86400.0, "outs": 27, "er": 0,
        "k": 0, "bb": 0, "pitches": 80, "fi_allowed": allowed,
    }


def _book(allowed, nstarts):
    starts = []
    for i in range(nstarts):
        starts.append(_start(1, i, allowed))
        starts.append(_start(2, i, allowed))
    return {"starts": starts, "games": []}


def _event(end, side):
    markets = {
        "Y": hold.market("Y", 0.40 if side == "Y" else 0.80, payout=1.0 if side == "Y" else 0.0, end=end),
        "N": hold.market("N", 0.40 if side == "N" else 0.80, payout=1.0 if side == "N" else 0.0, end=end),
    }
    ev = hold.pack("yrfi-%s" % side, end, "HOT", "COLD", markets, side, hold.prints_for(end))
    ev["kind"] = "nrfi"
    ev["hp"], ev["ap"] = 1, 2
    return ev


def self_check():
    end = hold.day0() + 40 * 86400.0
    _trade, hand = hold.assert_book(choose, _book(1, 8), _event(end, "Y"), "Y", 1.0)
    if choose(_event(end, "Y"), _book(1, 7)) is not None:
        raise SystemExit("seven first innings traded")
    hold.assert_book(choose, _book(0, 8), _event(end, "N"), "N", 1.0)
    other = _event(end, "Y")
    other["kind"] = "ml"
    if choose(other, _book(1, 8)) is not None:
        raise SystemExit("a moneyline was quoted as a first inning")
    broken = _event(end, "Y")
    broken["picked"] = dict(broken["picked"])
    broken["picked"]["prints"] = "incomplete"
    _trades, _counts, inc = hold.trades_from([broken], _book(1, 8), choose)
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
