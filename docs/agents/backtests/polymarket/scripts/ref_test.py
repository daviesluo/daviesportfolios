"""REF: buy the home side when this referee's home-win rate clears the price (fp5).

Eight prior matches of this referee. Not VENUE: the rate is the referee's,
and another referee's matches do not count. `--self-check` does not read a file.

usage: ref_test.py --self-check
       ref_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import epl_hold as hold
import epl_score as score
import post_test as post
import stat_score as stat

RULE = "REF"
PREREG = "reviews/2026-09-25-polymarket-fp5-prereg-ref.md"
MINIMUM = 8


def choose(ev, scores):
    return stat.ref_quote(ev, scores, minimum=MINIMUM)


def run(data):
    return hold.finish(data, choose, RULE, PREREG)


def _with_ref(day, home, away, hg, ag, ref):
    row = hold.played(day, home, away, hg, ag)
    row["ref"] = ref
    return row


def self_check():
    score.assert_names()
    scores = []
    for i in range(8):
        scores.append(_with_ref(i, "HOT", "P%d" % i, 1, 0, "A Taylor"))
    for i in range(3):
        scores.append(_with_ref(20 + i, "Q%d" % i, "COLD", 0, 1, "Other"))
    end = hold.day0() + 40 * 86400.0
    ev = hold.pack("ref-yes", end, "HOT", "COLD", hold.rich_board(0.40, 1.0, end), "H", hold.prints_for(end))
    ev["kind"] = "ml"
    ev["ref"] = "A Taylor"
    _trade, hand = hold.assert_book(choose, scores, ev, "H", 1.0)
    if choose(ev, scores[:7]) is not None:
        raise SystemExit("seven referee games traded")
    other = dict(ev)
    other["ref"] = "Other"
    if choose(other, scores) is not None:
        raise SystemExit("the other referee was used")
    bare = dict(ev)
    bare["ref"] = None
    if choose(bare, scores) is not None:
        raise SystemExit("a match with no referee traded")
    spread = dict(ev)
    spread["kind"] = "spread"
    if choose(spread, scores) is not None:
        raise SystemExit("a spread event traded as a referee")
    broken = dict(ev)
    broken["slug"] = "ref-incomplete"
    broken["picked"] = dict(ev["picked"])
    broken["picked"]["prints"] = "incomplete"
    _trades, _counts, inc = hold.trades_from([broken], scores, choose)
    if inc != 1 or post.evaluate(_trades, inc)["passes"]:
        raise SystemExit("incomplete tape passed")
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
