"""CLIM: buy the temperature bucket that contains the same calendar month's median (fp5).

Priors are the same city, kind and unit, already resolved, in the same month
number. The fair value is how often those priors landed in that bucket.
Not WX and not YDAY. `--self-check` does not read a file.

usage: clim_test.py --self-check
       clim_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import city_hold as city
import post_test as post


def choose(ev, priors):
    month = (ev.get("date") or "")[5:7]
    rows = [p for p in priors if p["date"][5:7] == month]
    mids = [city.mid_of(city.winner_market(p)) for p in rows]
    mids = [m for m in mids if m is not None]
    if len(mids) < city.MIN_PRIOR:
        return None
    market = city.containing(ev.get("markets") or [], city.median(mids))
    if market is None or market.get("p") is None:
        return None
    fair = sum(1 for m in mids if city.contains_iv(market["iv"], m)) / float(len(mids))
    tick = float(market.get("tick") or 0.01)
    if post.edge(fair, float(market["p"]) + tick, city.FEE) <= 0:
        return None
    return market, fair


def run(data):
    return city.finish(data, choose, "CLIM", "reviews/2026-09-25-polymarket-fp5-prereg-clim.md")


def _ev(date, event, mid_lo, shown, payout, td, closed):
    return {
        "event": event, "city": "Ex", "hl": "highest", "unit": "C", "date": date, "td": td,
        "prints_pulled": True, "prints_complete": True,
        "markets": [{
            "cond": "b", "iv": [mid_lo, mid_lo + 2], "payout_yes": payout, "p": shown, "tick": 0.01,
            "start": td - 86400, "closed": closed, "prints": [],
        }],
    }


def self_check():
    td = city.date_ts("2026-01-20") + 12 * 3600
    priors = []
    for i in range(8):
        day = "2025-01-%02d" % (i + 1)
        priors.append(_ev(day, "p%s" % i, 28, 0.5, 1.0, city.date_ts(day) - 12 * 3600, city.date_ts(day) + 20 * 3600))
    trade = _ev("2026-01-21", "t", 28, 0.20, 1.0, td, td + 86400)
    trade["markets"][0]["prints"] = [[td + 10, "BUY", 0, 0.19, 500.0]]
    rows = priors + [trade]
    got = choose(trade, city.known_priors(trade, rows))
    if got is None or got[0]["iv"] != [28, 30]:
        raise SystemExit("clim choose %s" % got)
    trades, counts, inc = city.trades_from(rows, choose)
    if inc or len(trades) != 1 or abs(trades[0]["fills"][0][1] - 0.21) > 1e-9:
        raise SystemExit("clim pin %s %s" % (trades, counts))
    sh = 10.0 / 0.21
    hand = sh * (1.0 - 0.21) - post.fee(0.05, 0.21) * sh
    if abs(post.pnl_of(trades[0]) - hand) > 1e-6 or abs(hand - 37.224048) > 1e-6:
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
