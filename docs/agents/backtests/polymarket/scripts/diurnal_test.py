"""DIURNAL: on a high, buy yesterday's low plus the month's median daily range (fp5).

The range is prior highs minus the low on the same date, same calendar month.
The fair value is how often prior highs landed in that bucket. Not WX: the
forecast field is not read. Not YDAY: yesterday's high is not the target.
`--self-check` does not read a file.

usage: diurnal_test.py --self-check
       diurnal_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import city_hold as city
import city_more as more


def choose(ev, priors, idx):
    if ev.get("hl") != "highest":
        return None
    base = more.recent_low(ev, idx)
    if base is None or not ev.get("date"):
        return None
    month = ev["date"][5:7]
    spreads = []
    for prior in priors:
        if prior["date"][5:7] != month:
            continue
        low = more.low_mid(ev.get("city"), ev.get("unit"), prior["date"], idx, ev["td"])
        high = city.mid_of(city.winner_market(prior))
        if low is None or high is None:
            continue
        spreads.append(high - low)
    if len(spreads) < city.MIN_PRIOR:
        return None
    market = city.containing(ev.get("markets") or [], base + city.median(spreads))
    return more.buy(market, more.hit(more.mids(priors), market))


def run(data):
    idx = more.indexes(data.get("events"))

    def bound(ev, priors):
        return choose(ev, priors, idx)

    return city.finish(data, bound, "DIURNAL", "reviews/2026-09-25-polymarket-fp5-prereg-diurnal.md")


def self_check():
    rows = []
    for day in range(1, 9):
        date = "2025-01-%02d" % day
        rows.append(more.prior(date, 22, hl="highest"))
        rows.append(more.prior(date, 10, hl="lowest"))
    rows.append(more.prior("2026-01-19", 22, hl="highest"))
    rows.append(more.prior("2026-01-19", 10, hl="lowest"))
    trade = more.live("2026-01-21", [
        {"lo": 0, "hi": 2, "cond": "cold", "shown": 0.02, "print_px": 0.01},
        {"lo": 21, "hi": 23, "cond": "day", "shown": 0.30, "payout": 1.0, "print_px": 0.25},
    ])
    rows.append(trade)
    idx = more.indexes(rows)
    got = choose(trade, city.known_priors(trade, rows), idx)
    if got is None or got[0]["iv"] != [21, 23]:
        raise SystemExit("diurnal choose %s" % (None if got is None else got[0]["iv"]))
    trades, _counts, inc = city.trades_from(rows, lambda ev, priors: choose(ev, priors, idx))
    if inc:
        raise SystemExit("incomplete")
    more.assert_fill(trades, 21, 23, 0.31, 21.913065)


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
