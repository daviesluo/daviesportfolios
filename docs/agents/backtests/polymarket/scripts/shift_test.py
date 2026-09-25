"""SHIFT: buy the bracket the histogram of past temperature changes points at (fp5).

Each linked step is added to yesterday's midpoint. The fair value of a bracket
is the fraction of those sums that land in it. Yesterday's own bracket is not
eligible. The bracket with the largest positive edge is the trade. Not JUMP:
there is no single extrapolated step, and the base-rate of one bracket is not
the fair value. `--self-check` does not read a file.

usage: shift_test.py --self-check
       shift_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import city_hold as city
import city_more as more
import post_test as post


def choose(ev, priors):
    prev = more.last_prior(priors, ev)
    if prev is None:
        return None
    base = city.mid_of(city.winner_market(prev))
    yiv = city.winner_market(prev)["iv"]
    steps = more.deltas(priors)
    if base is None or len(steps) < city.MIN_PRIOR:
        return None
    mapped = [base + step for step in steps]
    best = None
    for market in city.ordered(ev.get("markets") or []):
        if market.get("p") is None or city.same_iv(market["iv"], yiv):
            continue
        fair = more.hit(mapped, market)
        tick = float(market.get("tick") or 0.01)
        gap = post.edge(fair, float(market["p"]) + tick, city.FEE)
        if gap <= 0:
            continue
        lo = market["iv"][0]
        key = (-gap, lo is not None, 0.0 if lo is None else float(lo), str(market.get("cond") or ""))
        if best is None or key < best[0]:
            best = (key, market, fair)
    if best is None:
        return None
    return best[1], best[2]


def run(data):
    return city.finish(data, choose, "SHIFT", "reviews/2026-09-25-polymarket-fp5-prereg-shift.md")


def self_check():
    rows = [more.prior(more.add_days("2026-01-11", i), 10 * i) for i in range(9)]
    trade = more.live("2026-01-21", [
        {"lo": 79, "hi": 81, "cond": "yday", "shown": 0.01, "print_px": 0.01},
        {"lo": 89, "hi": 91, "cond": "step", "shown": 0.13, "payout": 1.0, "print_px": 0.10},
    ])
    rows.append(trade)
    got = choose(trade, city.known_priors(trade, rows))
    if got is None or got[0]["iv"] != [89, 91]:
        raise SystemExit("shift choose %s" % (None if got is None else got[0]["iv"]))
    flat = [more.prior(more.add_days("2026-01-11", i), 40) for i in range(9)]
    flat_trade = more.live("2026-01-21", [
        {"lo": 39, "hi": 41, "cond": "yday", "shown": 0.01, "print_px": 0.01},
        {"lo": 50, "hi": 52, "cond": "other", "shown": 0.01, "print_px": 0.01},
    ], event="flat")
    if choose(flat_trade, flat) is not None:
        raise SystemExit("yesterday's bracket was eligible")
    trades, _counts, inc = city.trades_from(rows, choose)
    if inc:
        raise SystemExit("incomplete")
    more.assert_fill(trades, 89, 91, 0.14, 60.998571)


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
