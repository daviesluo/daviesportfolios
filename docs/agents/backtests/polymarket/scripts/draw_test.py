"""DRAWBASE: buy the draw when the league's draw rate so far clears the screen (fp5).

Eight finished matches are required. It is not a club's home rate and not
VENUE. `--self-check` does not read a file.

usage: draw_test.py --self-check
       draw_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score

RULE = "DRAWBASE"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-drawbase.md"


def choose(ev, scores):
    return score.draw_quote(ev, scores, minimum=8)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def self_check():
    score.assert_names()
    scores = [hold.played(i, "A%d" % i, "B%d" % i, 1, 0) for i in range(6)]
    scores.append(hold.played(6, "C", "D", 1, 1))
    scores.append(hold.played(7, "E", "F", 0, 0))
    end = hold.day0() + 20 * 86400.0
    board = {
        "H": hold.market("H", 0.80, payout=0.0, end=end),
        "D": hold.market("D", 0.10, payout=1.0, end=end),
        "A": hold.market("A", 0.80, payout=0.0, end=end),
    }
    ev = hold.pack("draw-yes", end, "HOT", "COLD", board, "D", hold.prints_for(end))
    _trade, hand = hold.assert_book(choose, scores, ev, "D", 0.25)
    rich = dict(board)
    rich["D"] = hold.market("D", 0.50, payout=1.0, end=end)
    no = hold.pack("draw-no", end, "HOT", "COLD", rich, None, None)
    if choose(no, scores) is not None:
        raise SystemExit("a rich draw was bought")
    print("self-check ok", "D", round(0.25, 6), round(hand, 6))


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
