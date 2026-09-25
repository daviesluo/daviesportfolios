"""AGREE: buy only when the last three days and other cities name one bucket (fp5).

The three-day mean and the median of other cities' latest midpoints have to
fall in the same listed bucket. The fair value is this city's own hit rate.
Either estimate on its own is not a trade. Not CLIM and not YDAY. No forecast.
`--self-check` does not read a file.

usage: agree_test.py --self-check
       agree_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import city_hold as city
import city_more as more


def choose(ev, priors, idx):
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
    peers = more.peer_mids(ev, idx)
    if len(recent) < 3 or len(peers) < more.MIN_PEERS:
        return None
    own = city.containing(ev.get("markets") or [], more.mean(recent))
    other = city.containing(ev.get("markets") or [], city.median(peers))
    if own is None or other is None or own.get("cond") != other.get("cond"):
        return None
    return more.buy(own, more.hit(values, own))


def run(data):
    idx = more.indexes(data.get("events"))

    def bound(ev, priors):
        return choose(ev, priors, idx)

    return city.finish(data, bound, "AGREE", "reviews/2026-09-25-polymarket-fp5-prereg-agree.md")


def self_check():
    rows = [more.prior(more.add_days("2024-12-01", i), 20) for i in range(8)]
    for day in (17, 18, 19):
        rows.append(more.prior("2026-01-%02d" % day, 20))
    for name in ("A", "B", "C"):
        rows.append(more.prior("2026-01-19", 20, city_name=name))
    trade = more.live("2026-01-21", [
        {"lo": 0, "hi": 2, "cond": "cheap", "shown": 0.01, "print_px": 0.01},
        {"lo": 19, "hi": 21, "cond": "both", "shown": 0.18, "payout": 1.0, "print_px": 0.10},
    ])
    rows.append(trade)
    idx = more.indexes(rows)
    got = choose(trade, city.known_priors(trade, rows), idx)
    if got is None or got[0]["iv"] != [19, 21]:
        raise SystemExit("agree choose %s" % (None if got is None else got[0]["iv"]))
    split = more.live("2026-01-21", [
        {"lo": 9, "hi": 11, "cond": "peers", "shown": 0.10, "print_px": 0.05},
        {"lo": 19, "hi": 21, "cond": "own", "shown": 0.10, "print_px": 0.05},
    ], event="split")
    split_rows = [more.prior(more.add_days("2024-12-01", i), 20) for i in range(8)]
    for day in (17, 18, 19):
        split_rows.append(more.prior("2026-01-%02d" % day, 20))
    for name in ("A", "B", "C"):
        split_rows.append(more.prior("2026-01-19", 10, city_name=name))
    split_rows.append(split)
    if choose(split, city.known_priors(split, split_rows), more.indexes(split_rows)) is not None:
        raise SystemExit("a disagreement was a trade")
    trades, _counts, inc = city.trades_from(rows, lambda ev, priors: choose(ev, priors, idx))
    if inc:
        raise SystemExit("incomplete")
    more.assert_fill(trades, 19, 21, 0.19, 42.226579)


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
