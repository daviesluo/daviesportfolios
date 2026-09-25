"""MEAN3: buy the bucket that contains the mean of the last three midpoints (fp5).

The three resolved days, and the step from the last of them to today, are each
at most three days. The fair value is how often every prior midpoint landed in
that bucket. Not CLIM: not a month and not a median. Not JUMP: nothing is added
to the last step. Not YDAY. `--self-check` does not read a file.

usage: mean3_test.py --self-check
       mean3_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import city_hold as city
import city_more as more


def choose(ev, priors):
    values = more.mids(priors)
    if len(values) < city.MIN_PRIOR or len(priors) < 3:
        return None
    last = priors[-3:]
    if city.days_between(last[0]["date"], last[1]["date"]) > city.MAX_LAG_DAYS:
        return None
    if city.days_between(last[1]["date"], last[2]["date"]) > city.MAX_LAG_DAYS:
        return None
    if city.days_between(last[2]["date"], ev["date"]) > city.MAX_LAG_DAYS:
        return None
    recent = more.mids(last)
    if len(recent) < 3:
        return None
    market = city.containing(ev.get("markets") or [], more.mean(recent))
    return more.buy(market, more.hit(values, market))


def run(data):
    return city.finish(data, choose, "MEAN3", "reviews/2026-09-25-polymarket-fp5-prereg-mean3.md")


def self_check():
    rows = [more.prior(more.add_days("2024-12-01", i), 20) for i in range(8)]
    for day in (17, 18, 19):
        rows.append(more.prior("2026-01-%02d" % day, 20))
    trade = more.live("2026-01-21", [
        {"lo": 0, "hi": 2, "cond": "cheap", "shown": 0.02, "print_px": 0.01},
        {"lo": 19, "hi": 21, "cond": "avg", "shown": 0.35, "payout": 1.0, "print_px": 0.30},
    ])
    rows.append(trade)
    got = choose(trade, city.known_priors(trade, rows))
    if got is None or got[0]["iv"] != [19, 21]:
        raise SystemExit("mean3 choose %s" % (None if got is None else got[0]["iv"]))
    trades, _counts, inc = city.trades_from(rows, choose)
    if inc:
        raise SystemExit("incomplete")
    more.assert_fill(trades, 19, 21, 0.36, 17.457778)


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
