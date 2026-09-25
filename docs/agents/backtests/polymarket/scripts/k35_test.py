"""K35: one pitcher's strikeouts over 3.5 (fp5).

The fair value is how often his last starts reached four strikeouts. A 4.5
line does not trade. A reliever with no starts does not trade. `--self-check`
does not read a file.

usage: k35_test.py --self-check
       k35_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import mlb_score as mlb
import post_test as post

RULE = "K35"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-k35.md"
LINE = 3.5
N = 10
MINIMUM = 8


def choose(ev, book):
    return mlb.k_quote(ev, book, line=LINE, n=N, minimum=MINIMUM)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _book(nstarts, k):
    starts = []
    for i in range(nstarts):
        starts.append({
            "pid": 9, "ts": hold.day0() + i * 86400.0, "outs": 27, "er": 0,
            "k": k, "bb": 0, "pitches": 80,
        })
    return {"starts": starts, "games": []}


def _event(end, side, line):
    markets = {
        "Y": hold.market("Y", 0.40 if side == "Y" else 0.80, payout=1.0 if side == "Y" else 0.0, end=end),
        "N": hold.market("N", 0.40 if side == "N" else 0.80, payout=1.0 if side == "N" else 0.0, end=end),
    }
    ev = hold.pack("k-%s" % side, end, None, None, markets, side, hold.prints_for(end))
    ev["kind"] = "k"
    ev["pid"] = 9
    ev["line"] = line
    return ev


def self_check():
    end = hold.day0() + 40 * 86400.0
    _trade, hand = hold.assert_book(choose, _book(8, 4), _event(end, "Y", 3.5), "Y", 1.0)
    if choose(_event(end, "Y", 3.5), _book(7, 4)) is not None:
        raise SystemExit("seven starts traded")
    if choose(_event(end, "Y", 4.5), _book(8, 4)) is not None:
        raise SystemExit("a 4.5 strikeout line traded")
    broken = _event(end, "Y", 3.5)
    broken["picked"] = dict(broken["picked"])
    broken["picked"]["prints"] = "incomplete"
    _trades, _counts, inc = hold.trades_from([broken], _book(8, 4), choose)
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
