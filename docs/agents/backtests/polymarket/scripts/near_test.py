"""NEAR: buy the bracket next to the dearest one, on the side toward the median (fp5).

The dearest shown bracket is the crowd. The trade is the adjacent bracket whose
midpoint is closer to the median of past winning midpoints, and only when the
mode does not already contain that median. Not HITS and not POST.
`--self-check` does not read a file.

usage: near_test.py --self-check
       near_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import ladder_hold as hold
import post_test as post

MIN_PRIOR = post.MIN_PRIOR


def _ordered(markets):
    return sorted(markets, key=lambda m: (int(m["lo"]), str(m.get("condition") or "")))


def _mode(markets):
    return min(markets, key=lambda m: (-float(m["shown"]), int(m["lo"]), str(m.get("condition") or "")))


def choose(ev, prior_mids):
    if len(prior_mids) < MIN_PRIOR:
        return None
    markets = _ordered(hold.priced(ev))
    if len(markets) < 2:
        return None
    med = hold.median(prior_mids)
    mode = _mode(markets)
    if post.contains(mode["lo"], mode["hi"], med):
        return None
    idx = next(i for i, m in enumerate(markets) if m["condition"] == mode["condition"])
    neighbors = []
    if idx > 0:
        neighbors.append(markets[idx - 1])
    if idx + 1 < len(markets):
        neighbors.append(markets[idx + 1])
    mode_dist = abs(post.midpoint(mode["lo"], mode["hi"]) - med)
    best = None
    for m in neighbors:
        dist = abs(post.midpoint(m["lo"], m["hi"]) - med)
        if dist >= mode_dist - 1e-12:
            continue
        key = (dist, int(m["lo"]), str(m.get("condition") or ""))
        if best is None or key < best[0]:
            best = (key, m)
    if best is None:
        return None
    market = best[1]
    fair = hold.hit_rate(prior_mids, market)
    if post.edge(fair, float(market["shown"]) + float(market["tick"]), float(market["rate"])) <= 0:
        return None
    return market, fair


def run(data):
    return hold.finish(data, choose, hold.mids_before, "NEAR", "reviews/2026-09-25-polymarket-fp5-prereg-near.md")


def _mkt(lo, hi, shown, condition, payout=0.0, rate=0.0):
    return {
        "condition": condition, "lo": lo, "hi": hi, "shown": shown, "tick": 0.001, "rate": rate,
        "payout_yes": payout, "closed": None,
    }


def self_check():
    end = post.T_OOS1 + 20 * 86400
    start = end - 10 * 86400
    td = start + post.OPEN_LAG
    priors = []
    for i in range(MIN_PRIOR):
        priors.append({
            "slug": "p%s" % i, "series": 10000, "days": 7,
            "start": start - (i + 2) * 10 * 86400, "end": start - (i + 1) * 86400,
            "closed": start - (i + 1) * 86400, "winner_mid": 70.0,
            "markets": [_mkt(60, 79, 0.2, "w", payout=1.0)],
        })
    markets = [_mkt(40, 59, 0.05, "a"), _mkt(60, 79, 0.20, "b", payout=1.0), _mkt(80, 99, 0.55, "c")]
    buy = [[td + 10, "BUY", 0, 0.19, 200.0]]
    ev = {
        "slug": "near-example", "series": 10000, "days": 7, "start": start, "end": end, "closed": end,
        "winner_mid": 70.0, "markets": markets, "picked": {"condition": "b", "prints": buy},
    }
    trades, counts, _ = hold.trades_from(priors + [ev], choose, hold.mids_before)
    if len(trades) != 1 or trades[0]["lo"] != 60 or abs(trades[0]["fills"][0][1] - 0.201) > 1e-9:
        raise SystemExit("near pin %s %s" % (trades, counts))
    sh = 10.0 / 0.201
    hand = sh * (1.0 - 0.201)
    if abs(post.pnl_of(trades[0]) - hand) > 1e-6 or abs(hand - 39.751244) > 1e-6:
        raise SystemExit("pnl %s != %s" % (post.pnl_of(trades[0]), hand))
    inside = dict(ev)
    inside["markets"] = [_mkt(40, 59, 0.05, "a"), _mkt(60, 79, 0.70, "b"), _mkt(80, 99, 0.10, "c")]
    inside["picked"] = None
    if hold.trades_from(priors + [inside], choose, hold.mids_before)[0]:
        raise SystemExit("a mode that already holds the median was traded")
    print("self-check ok", round(hand, 6))


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--self-check":
        self_check()
    else:
        with gzip.open(sys.argv[1], "rt") as f:
            data = json.load(f)
        hold.write_result(sys.argv[2], run(data))
        out = json.load(open(sys.argv[2]))
        print("passes", out["result"]["passes"], "oos", out["result"]["OOS"], "bar", out["result"]["bar"])
