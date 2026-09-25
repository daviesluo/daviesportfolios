"""JUMP: buy the temperature bucket two resolved steps point at (fp5).

The last two resolved days of the same city, kind and unit name a midpoint
one step further in the same direction. The fair value is how often past
winning midpoints landed in that bucket. A zero step is no trade. Not WX.
`--self-check` does not read a file.

usage: jump_test.py --self-check
       jump_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import city_hold as city
import post_test as post


def choose(ev, priors):
    if len(priors) < city.MIN_PRIOR:
        return None
    older, newer = priors[-2], priors[-1]
    if city.days_between(newer["date"], ev["date"]) > city.MAX_LAG_DAYS:
        return None
    if city.days_between(older["date"], newer["date"]) > city.MAX_LAG_DAYS:
        return None
    new_mid = city.mid_of(city.winner_market(newer))
    old_mid = city.mid_of(city.winner_market(older))
    if new_mid is None or old_mid is None or abs(new_mid - old_mid) <= 1e-12:
        return None
    forecast = new_mid + (new_mid - old_mid)
    market = city.containing(ev.get("markets") or [], forecast)
    if market is None or market.get("p") is None:
        return None
    mids = []
    for prior in priors:
        mid = city.mid_of(city.winner_market(prior))
        if mid is not None:
            mids.append(mid)
    if len(mids) < city.MIN_PRIOR:
        return None
    fair = sum(1 for mid in mids if city.contains_iv(market["iv"], mid)) / float(len(mids))
    tick = float(market.get("tick") or 0.01)
    if post.edge(fair, float(market["p"]) + tick, city.FEE) <= 0:
        return None
    return market, fair


def run(data):
    return city.finish(data, choose, "JUMP", "reviews/2026-09-25-polymarket-fp5-prereg-jump.md")


def _ev(date, event, lo, shown, payout, td, closed, prints=None):
    return {
        "event": event, "city": "Ex", "hl": "highest", "unit": "C", "date": date, "td": td,
        "prints_pulled": True, "prints_complete": True,
        "markets": [{
            "cond": "b%s" % lo, "iv": [lo, lo + 4], "payout_yes": payout, "p": shown, "tick": 0.01,
            "start": 1, "closed": closed, "prints": prints or [],
        }],
    }


def self_check():
    td = city.date_ts("2026-03-01") + 12 * 3600
    priors = []
    for i in range(8):
        day = "2026-02-%02d" % (18 + i)
        priors.append(_ev(day, "p%s" % i, 38, 0.4, 1.0, city.date_ts(day) - 12 * 3600, city.date_ts(day) + 20 * 3600))
    # Two latest resolved days, mids 20 and 30, so the step points at 40.
    priors.append(_ev("2026-02-26", "o", 18, 0.4, 1.0, city.date_ts("2026-02-26") - 12 * 3600, city.date_ts("2026-02-26") + 20 * 3600))
    priors.append(_ev("2026-02-27", "n", 28, 0.4, 1.0, city.date_ts("2026-02-27") - 12 * 3600, city.date_ts("2026-02-27") + 20 * 3600))
    trade = _ev("2026-03-01", "t", 38, 0.40, 1.0, td, td + 86400, [[td + 10, "BUY", 0, 0.39, 500.0]])
    trade["markets"][0]["start"] = td - 10
    rows = priors + [trade]
    got = choose(trade, city.known_priors(trade, rows))
    if got is None or got[0]["iv"] != [38, 42]:
        raise SystemExit("jump choose %s" % (None if got is None else got[0]["iv"]))
    trades, counts, inc = city.trades_from(rows, choose)
    if inc or len(trades) != 1 or abs(trades[0]["fills"][0][1] - 0.41) > 1e-9:
        raise SystemExit("jump pin %s %s" % (trades, counts))
    sh = 10.0 / 0.41
    hand = sh * (1.0 - 0.41) - post.fee(0.05, 0.41) * sh
    if abs(post.pnl_of(trades[0]) - hand) > 1e-6 or abs(hand - 14.095244) > 1e-6:
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
