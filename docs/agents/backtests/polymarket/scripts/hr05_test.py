"""HR05: one batter's home runs over 0.5 (fp5).

The fair value is how often his last appearances included a home run. A 1.5
line does not trade. Each batter is his own row. `--self-check` does not
read a file.

usage: hr05_test.py --self-check
       hr05_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import mlb_score as mlb
import post_test as post

RULE = "HR05"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-hr05.md"
N = 20
MINIMUM = 10


def choose(ev, book):
    return mlb.hr_quote(ev, book, n=N, minimum=MINIMUM)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _book(n_rows, hr):
    hitters = []
    for i in range(n_rows):
        hitters.append({"pid": 7, "ts": hold.day0() + i * 86400.0, "hr": hr})
    return {"hitters": hitters, "games": [], "starts": []}


def _event(end, side, line):
    markets = {
        "Y": hold.market("Y", 0.40 if side == "Y" else 0.80, payout=1.0 if side == "Y" else 0.0, end=end),
        "N": hold.market("N", 0.40 if side == "N" else 0.80, payout=1.0 if side == "N" else 0.0, end=end),
    }
    ev = hold.pack("hr-%s" % side, end, None, None, markets, side, hold.prints_for(end))
    ev["kind"] = "hr"
    ev["pid"] = 7
    ev["line"] = line
    return ev


def self_check():
    end = hold.day0() + 40 * 86400.0
    _trade, hand = hold.assert_book(choose, _book(10, 1), _event(end, "Y", 0.5), "Y", 1.0)
    if choose(_event(end, "Y", 0.5), _book(9, 1)) is not None:
        raise SystemExit("nine appearances traded")
    if choose(_event(end, "Y", 1.5), _book(10, 1)) is not None:
        raise SystemExit("a 1.5 home-run line traded")
    broken = _event(end, "Y", 0.5)
    broken["picked"] = dict(broken["picked"])
    broken["picked"]["prints"] = "incomplete"
    _trades, _counts, inc = hold.trades_from([broken], _book(10, 1), choose)
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
