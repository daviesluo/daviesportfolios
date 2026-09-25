"""BACK: one listed bucket from yesterday toward the month's median (fp5).

The median bucket itself is never the trade, and neither is yesterday's bucket.
The fair value is how often this month's prior midpoints landed in the bucket
one step from yesterday. Not CLIM, not HOT and not YDAY. `--self-check` does
not read a file.

usage: back_test.py --self-check
       back_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import city_hold as city
import city_more as more


def choose(ev, priors):
    prev = more.last_prior(priors, ev)
    if prev is None or not ev.get("date"):
        return None
    month = ev["date"][5:7]
    values = more.mids([p for p in priors if p["date"][5:7] == month])
    if len(values) < city.MIN_PRIOR:
        return None
    med = city.median(values)
    board = city.ordered(ev.get("markets") or [])
    origin = city.match_iv(board, city.winner_market(prev)["iv"])
    holder = city.containing(board, med)
    if origin is None or holder is None or city.contains_iv(origin["iv"], med):
        return None
    iy = next(i for i, m in enumerate(board) if m["cond"] == origin["cond"])
    im = next(i for i, m in enumerate(board) if m["cond"] == holder["cond"])
    if iy == im:
        return None
    step = 1 if im > iy else -1
    j = iy + step
    if j == im or j < 0 or j >= len(board):
        return None
    market = board[j]
    if city.contains_iv(market["iv"], med):
        return None
    return more.buy(market, more.hit(values, market))


def run(data):
    return city.finish(data, choose, "BACK", "reviews/2026-09-25-polymarket-fp5-prereg-back.md")


def self_check():
    rows = []
    for day, mid in enumerate([30, 30, 30, 30, 30, 30, 20, 20], start=1):
        rows.append(more.prior("2026-01-%02d" % day, mid))
    rows.append(more.prior("2026-01-19", 10))
    trade = more.live("2026-01-21", [
        {"lo": 9, "hi": 11, "cond": "yday", "shown": 0.02, "print_px": 0.01},
        {"lo": 19, "hi": 21, "cond": "mid", "shown": 0.10, "payout": 1.0, "print_px": 0.05},
        {"lo": 29, "hi": 31, "cond": "med", "shown": 0.40, "print_px": 0.30},
    ])
    rows.append(trade)
    got = choose(trade, city.known_priors(trade, rows))
    if got is None or got[0]["iv"] != [19, 21]:
        raise SystemExit("back choose %s" % (None if got is None else got[0]["iv"]))
    trades, _counts, inc = city.trades_from(rows, choose)
    if inc:
        raise SystemExit("incomplete")
    more.assert_fill(trades, 19, 21, 0.11, 80.464091)


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
