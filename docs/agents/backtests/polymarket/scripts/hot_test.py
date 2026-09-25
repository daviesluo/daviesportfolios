"""HOT: on a highest-temperature market, buy the bucket above the month's median (fp5).

The median bucket is not the trade. The next listed bucket above it is, and
its own hit rate has to clear the price. Lowest-temperature markets are outside
the rule. Not CLIM and not WX. `--self-check` does not read a file.

usage: hot_test.py --self-check
       hot_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import city_hold as city
import post_test as post


def choose(ev, priors):
    if ev.get("hl") != "highest":
        return None
    month = (ev.get("date") or "")[5:7]
    rows = [p for p in priors if p["date"][5:7] == month]
    mids = [city.mid_of(city.winner_market(p)) for p in rows]
    mids = [m for m in mids if m is not None]
    if len(mids) < city.MIN_PRIOR:
        return None
    med = city.median(mids)
    board = city.ordered(ev.get("markets") or [])
    holder = city.containing(board, med)
    if holder is None:
        return None
    idx = next(i for i, m in enumerate(board) if m["cond"] == holder["cond"])
    if idx + 1 >= len(board):
        return None
    market = board[idx + 1]
    if market.get("p") is None:
        return None
    fair = sum(1 for m in mids if city.contains_iv(market["iv"], m)) / float(len(mids))
    tick = float(market.get("tick") or 0.01)
    if post.edge(fair, float(market["p"]) + tick, city.FEE) <= 0:
        return None
    return market, fair


def run(data):
    return city.finish(data, choose, "HOT", "reviews/2026-09-25-polymarket-fp5-prereg-hot.md")


def _board(lo_shown, hi_shown):
    return [
        {"cond": "lo", "iv": [28, 32], "payout_yes": 1.0, "p": lo_shown, "tick": 0.01, "start": 1, "closed": 9, "prints": []},
        {"cond": "hi", "iv": [33, 37], "payout_yes": 1.0, "p": hi_shown, "tick": 0.01, "start": 1, "closed": 9, "prints": []},
    ]


def _prior(i, mid_lo):
    day = "2025-01-%02d" % (i + 1)
    closed = city.date_ts(day) + 20 * 3600
    return {
        "event": "p%s" % i, "city": "Ex", "hl": "highest", "unit": "F", "date": day,
        "td": city.date_ts(day) - 12 * 3600, "prints_pulled": True, "prints_complete": True,
        "markets": [{
            "cond": "w", "iv": [mid_lo, mid_lo + 4], "payout_yes": 1.0, "p": 0.5, "tick": 0.01,
            "start": 1, "closed": closed, "prints": [],
        }],
    }


def self_check():
    td = city.date_ts("2026-01-20") + 12 * 3600
    priors = [_prior(i, 28) for i in range(6)] + [_prior(6, 33), _prior(7, 33)]
    trade = {
        "event": "t", "city": "Ex", "hl": "highest", "unit": "F", "date": "2026-01-21", "td": td,
        "prints_pulled": True, "prints_complete": True, "markets": _board(0.40, 0.05),
    }
    for m in trade["markets"]:
        m["start"] = td - 10
        m["closed"] = td + 86400
    trade["markets"][1]["prints"] = [[td + 10, "BUY", 0, 0.04, 500.0]]
    trade["markets"][1]["payout_yes"] = 1.0
    rows = priors + [trade]
    got = choose(trade, city.known_priors(trade, rows))
    if got is None or got[0]["iv"] != [33, 37]:
        raise SystemExit("hot choose %s" % (None if got is None else got[0]["iv"]))
    low = dict(trade)
    low["hl"] = "lowest"
    low["event"] = "low"
    if choose(low, city.known_priors(low, priors + [low])) is not None:
        raise SystemExit("a lowest-temperature market was eligible")
    trades, counts, inc = city.trades_from(rows, choose)
    if inc or len(trades) != 1 or abs(trades[0]["fills"][0][1] - 0.06) > 1e-9:
        raise SystemExit("hot pin %s %s" % (trades, counts))
    sh = 10.0 / 0.06
    hand = sh * (1.0 - 0.06) - post.fee(0.05, 0.06) * sh
    if abs(post.pnl_of(trades[0]) - hand) > 1e-6 or abs(hand - 156.196667) > 1e-6:
        raise SystemExit("pnl %s != %s" % (post.pnl_of(trades[0]), hand))
    print("self-check ok", round(hand, 6))


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
