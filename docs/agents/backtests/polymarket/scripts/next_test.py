"""NEXT: buy the other bucket yesterday's bucket most often moved to (fp5).

Transitions are consecutive resolved days at most three days apart. The fair
value is that destination's count divided by every transition out of
yesterday's bucket, including the ones that stayed. A stay is not a trade.
Not YDAY. `--self-check` does not read a file.

usage: next_test.py --self-check
       next_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import city_hold as city
import city_more as more


def choose(ev, priors):
    prev = more.last_prior(priors, ev)
    if prev is None:
        return None
    source = city.norm_iv(city.winner_market(prev)["iv"])
    counts = {}
    n_from = 0
    for left, right in more.linked(priors):
        left_iv = city.norm_iv(city.winner_market(left)["iv"])
        if left_iv != source:
            continue
        n_from += 1
        right_iv = city.norm_iv(city.winner_market(right)["iv"])
        if right_iv == source:
            continue
        counts[right_iv] = counts.get(right_iv, 0) + 1
    if n_from < city.MIN_PRIOR or not counts:
        return None

    def key(item):
        iv, count = item
        lo, hi = iv
        return (-count, lo is not None, 0.0 if lo is None else lo, hi is not None, 0.0 if hi is None else hi)

    iv, count = min(counts.items(), key=key)
    market = city.match_iv(ev.get("markets") or [], iv)
    return more.buy(market, count / float(n_from))


def run(data):
    return city.finish(data, choose, "NEXT", "reviews/2026-09-25-polymarket-fp5-prereg-next.md")


def self_check():
    rows = []
    for i in range(17):
        rows.append(more.prior(more.add_days("2026-01-03", i), 10 if i % 2 == 0 else 20))
    trade = more.live("2026-01-21", [
        {"lo": 9, "hi": 11, "cond": "stay", "shown": 0.05, "print_px": 0.04},
        {"lo": 19, "hi": 21, "cond": "move", "shown": 0.22, "payout": 1.0, "print_px": 0.20},
    ])
    rows.append(trade)
    got = choose(trade, city.known_priors(trade, rows))
    if got is None or got[0]["iv"] != [19, 21]:
        raise SystemExit("next choose %s" % (None if got is None else got[0]["iv"]))
    stays = [more.prior(more.add_days("2026-01-11", i), 10) for i in range(9)]
    stay_trade = more.live("2026-01-21", [
        {"lo": 9, "hi": 11, "cond": "stay", "shown": 0.05, "print_px": 0.04},
    ], event="stay")
    if choose(stay_trade, stays) is not None:
        raise SystemExit("a stay was a trade")
    trades, _counts, inc = city.trades_from(rows, choose)
    if inc:
        raise SystemExit("incomplete")
    more.assert_fill(trades, 19, 21, 0.23, 33.093261)


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
