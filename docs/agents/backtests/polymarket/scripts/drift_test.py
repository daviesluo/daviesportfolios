"""DRIFT: one listed bucket beside yesterday, on the side past steps mostly took (fp5).

A step of zero does not vote. A tie, or no bucket on that side, is no trade.
The fair value is how often prior midpoints landed in the chosen bucket. Not
JUMP: the last step's size does not move the target, and the side is the whole
history. `--self-check` does not read a file.

usage: drift_test.py --self-check
       drift_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import city_hold as city
import city_more as more


def choose(ev, priors):
    prev = more.last_prior(priors, ev)
    values = more.mids(priors)
    steps = more.deltas(priors)
    if prev is None or len(values) < city.MIN_PRIOR or len(steps) < city.MIN_PRIOR:
        return None
    pos = sum(1 for step in steps if step > 1e-12)
    neg = sum(1 for step in steps if step < -1e-12)
    if pos == neg:
        return None
    board = city.ordered(ev.get("markets") or [])
    origin = city.match_iv(board, city.winner_market(prev)["iv"])
    if origin is None:
        return None
    iy = next(i for i, m in enumerate(board) if m["cond"] == origin["cond"])
    j = iy + (1 if pos > neg else -1)
    if j < 0 or j >= len(board):
        return None
    return more.buy(board[j], more.hit(values, board[j]))


def run(data):
    return city.finish(data, choose, "DRIFT", "reviews/2026-09-25-polymarket-fp5-prereg-drift.md")


def self_check():
    mids = [22, 18, 20, 22, 20, 22, 18, 20, 20]
    rows = [more.prior(more.add_days("2026-01-11", i), mid) for i, mid in enumerate(mids)]
    trade = more.live("2026-01-21", [
        {"lo": 17, "hi": 19, "cond": "low", "shown": 0.05, "print_px": 0.04},
        {"lo": 19, "hi": 21, "cond": "yday", "shown": 0.05, "print_px": 0.04},
        {"lo": 21, "hi": 23, "cond": "up", "shown": 0.27, "payout": 1.0, "print_px": 0.20},
    ])
    rows.append(trade)
    got = choose(trade, city.known_priors(trade, rows))
    if got is None or got[0]["iv"] != [21, 23]:
        raise SystemExit("drift choose %s" % (None if got is None else got[0]["iv"]))
    trades, _counts, inc = city.trades_from(rows, choose)
    if inc:
        raise SystemExit("incomplete")
    more.assert_fill(trades, 21, 23, 0.28, 25.354286)


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--self-check":
        self_check()
    else:
        with gzip.open(sys.argv[1], "rt") as f:
            data = json.load(f)
        payload = run(data)
        with open(sys.argv[2], "w") as f:
            json.dump(payload, f, indent=2, sort_keys=True)
            f.write("\n")
        print("passes", payload["result"]["passes"], "oos", payload["result"]["OOS"], "bar", payload["result"]["bar"])
