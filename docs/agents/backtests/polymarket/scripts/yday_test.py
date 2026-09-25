"""YDAY: buy today's temperature bucket when it is the last resolved day's bucket (fp5).

The fair value is how often the next resolved day of the same city, kind and
unit landed in the previous day's bucket. Not WX: no forecast. The decision
time is noon UTC on the day before the temperature date, and a day counts only
after its market has closed. `--self-check` does not read a file.

usage: yday_test.py --self-check
       yday_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import city_hold as city
import post_test as post


def choose(ev, priors):
    if not priors:
        return None
    prev = priors[-1]
    if city.days_between(prev["date"], ev["date"]) > city.MAX_LAG_DAYS:
        return None
    pairs = []
    for left, right in zip(priors, priors[1:]):
        if city.days_between(left["date"], right["date"]) > city.MAX_LAG_DAYS:
            continue
        pairs.append((left, right))
    if len(pairs) < city.MIN_PRIOR:
        return None
    won = city.winner_market(prev)
    hits = 0
    for left, right in pairs:
        if city.same_iv(city.winner_market(left)["iv"], city.winner_market(right)["iv"]):
            hits += 1
    fair = hits / float(len(pairs))
    market = city.match_iv(ev.get("markets") or [], won["iv"])
    if market is None or market.get("p") is None:
        return None
    tick = float(market.get("tick") or 0.01)
    if post.edge(fair, float(market["p"]) + tick, city.FEE) <= 0:
        return None
    return market, fair


def run(data):
    return city.finish(data, choose, "YDAY", "reviews/2026-09-25-polymarket-fp5-prereg-yday.md")


def _mkt(lo, hi, cond, payout, shown, closed):
    return {
        "cond": cond, "iv": [lo, hi], "payout_yes": payout, "p": shown, "tick": 0.01,
        "start": 1, "closed": closed, "prints": [],
    }


def _ev(date, event, closed, shown, payout, td):
    return {
        "event": event, "city": "Ex", "hl": "highest", "unit": "F", "date": date, "td": td,
        "prints_pulled": True, "prints_complete": True,
        "markets": [_mkt(70, 72, "b", payout, shown, closed)],
    }


def self_check():
    # Nine resolved days, every winner in 70-72, then one trade. Eight pairs all match.
    rows = []
    for i in range(9):
        day = "2025-06-%02d" % (i + 1)
        rows.append(_ev(day, "p%s" % i, city.date_ts(day) + 20 * 3600, 0.5, 1.0, city.date_ts(day) - 12 * 3600))
    trade_day = "2026-03-02"
    td = city.date_ts("2026-03-01") + 12 * 3600
    trade = _ev(trade_day, "t", td + 30 * 3600, 0.40, 1.0, td)
    trade["markets"][0]["prints"] = [[td + 10, "BUY", 0, 0.39, 500.0]]
    # The last prior is 2025-06-09, more than three days before 2026-03-02, so it must not trade.
    stale = dict(trade)
    if choose(stale, city.known_priors(stale, rows + [stale])) is not None:
        raise SystemExit("a stale previous day was eligible")
    fresh_priors = []
    for i in range(9):
        day = "2026-02-%02d" % (18 + i)
        fresh_priors.append(_ev(day, "f%s" % i, city.date_ts(day) + 20 * 3600, 0.5, 1.0, city.date_ts(day) - 12 * 3600))
    # 2026-02-18 through 2026-02-26. Trade date 2026-03-02 is 4 days after 02-26. Still stale.
    # Use 2026-02-28 as the last day: dates 02-20 .. 02-28.
    fresh_priors = []
    for i in range(9):
        day = "2026-02-%02d" % (20 + i)
        fresh_priors.append(_ev(day, "f%s" % i, city.date_ts(day) + 20 * 3600, 0.5, 1.0, city.date_ts(day) - 12 * 3600))
    trade = _ev("2026-03-01", "t", td + 30 * 3600, 0.40, 1.0, td)
    trade["markets"][0]["prints"] = [[td + 10, "BUY", 0, 0.39, 500.0]]
    # td is noon on 2026-03-01? I set td = date_ts(2026-03-01)+12h which is noon ON the temperature
    # date, not the day before. The pin only needs closed <= td and lag <= 3.
    # Last prior 2026-02-28 closes at 2026-02-28 20:00. td = 2026-03-01 12:00. Lag = 1 day. Good.
    td = city.date_ts("2026-03-01") + 12 * 3600
    trade["td"] = td
    trade["markets"][0]["start"] = td - 86400
    trade["markets"][0]["closed"] = td + 86400
    trade["markets"][0]["prints"] = [[td + 10, "BUY", 0, 0.39, 500.0]]
    rows = fresh_priors + [trade]
    got = choose(trade, city.known_priors(trade, rows))
    if got is None or got[0]["iv"] != [70, 72]:
        raise SystemExit("yday choose %s" % (None if got is None else got[0]["iv"]))
    trades, counts, inc = city.trades_from(rows, choose)
    if inc or len(trades) != 1 or abs(trades[0]["fills"][0][1] - 0.41) > 1e-9:
        raise SystemExit("yday pin %s %s" % (trades, counts))
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
