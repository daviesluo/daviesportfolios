"""PEER: buy the bucket that contains other cities' latest temperatures (fp5).

The fair value is this city's own hit rate for that bucket. Not CLIM: the
month's median of this city is not the target. Not YDAY. No forecast.
`--self-check` does not read a file.

usage: peer_test.py --self-check
       peer_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import city_hold as city
import city_more as more


def choose(ev, priors, idx):
    own = more.mids(priors)
    if len(own) < city.MIN_PRIOR:
        return None
    peers = more.peer_mids(ev, idx)
    if len(peers) < more.MIN_PEERS:
        return None
    market = city.containing(ev.get("markets") or [], city.median(peers))
    if market is None:
        return None
    return more.buy(market, more.hit(own, market))


def run(data):
    idx = more.indexes(data.get("events"))

    def bound(ev, priors):
        return choose(ev, priors, idx)

    return city.finish(data, bound, "PEER", "reviews/2026-09-25-polymarket-fp5-prereg-peer.md")


def self_check():
    rows = []
    for i, mid in enumerate([10, 10, 10, 10, 10, 20, 20, 20]):
        rows.append(more.prior(more.add_days("2024-12-01", i), mid))
    for name, mid in (("A", 20), ("B", 20), ("C", 22)):
        rows.append(more.prior("2026-01-19", mid, city_name=name))
    trade = more.live("2026-01-21", [
        {"lo": 9, "hi": 11, "cond": "own", "shown": 0.02, "print_px": 0.01},
        {"lo": 19, "hi": 21, "cond": "peer", "shown": 0.20, "payout": 1.0, "print_px": 0.19},
    ])
    rows.append(trade)
    idx = more.indexes(rows)
    got = choose(trade, city.known_priors(trade, rows), idx)
    if got is None or got[0]["iv"] != [19, 21]:
        raise SystemExit("peer choose %s" % (None if got is None else got[0]["iv"]))
    trades, _counts, inc = city.trades_from(rows, lambda ev, priors: choose(ev, priors, idx))
    if inc:
        raise SystemExit("incomplete")
    more.assert_fill(trades, 19, 21, 0.21, 37.224048)


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
