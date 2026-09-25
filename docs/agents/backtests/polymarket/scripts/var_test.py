"""VAR: the post-count bracket named by the gap between two variances (fp5).

The historical variance of winning midpoints is compared with the variance of
the shown prices. A richer book buys the bracket around the historical mean.
A cheaper book buys the bracket furthest from that mean. The hit rate of the
chosen bracket still has to clear the price. Not POISSON: no Poisson probability,
and the bracket is not the maximum edge. `--self-check` does not read a file.

usage: var_test.py --self-check
       var_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import ladder_hold as hold
import post_test as post

MIN_PRIOR = post.MIN_PRIOR


def _moments(xs):
    n = float(len(xs))
    mu = sum(xs) / n
    var = sum((float(x) - mu) ** 2 for x in xs) / n
    return mu, var


def _implied(markets):
    rows = []
    for m in markets:
        shown = float(m["shown"])
        if not (0.0 < shown < 1.0):
            continue
        rows.append((shown, post.midpoint(m["lo"], m["hi"])))
    total = sum(w for w, _ in rows)
    if total <= 0 or not rows:
        return None
    mu = sum(w * x for w, x in rows) / total
    var = sum(w * (x - mu) ** 2 for w, x in rows) / total
    return var


def target(ev, prior_mids):
    """The bracket the variance comparison names, before the fee."""
    if len(prior_mids) < MIN_PRIOR:
        return None
    markets = hold.priced(ev)
    if len(markets) < 2:
        return None
    mu, hist = _moments(prior_mids)
    implied = _implied(markets)
    if implied is None or abs(implied - hist) <= 1e-12:
        return None
    if implied > hist:
        return hold.bracket_containing(markets, mu)
    best = None
    for m in markets:
        dist = abs(post.midpoint(m["lo"], m["hi"]) - mu)
        key = (-dist, -int(m["lo"]), str(m.get("condition") or ""))
        if best is None or key < best[0]:
            best = (key, m)
    return best[1]


def choose(ev, prior_mids):
    market = target(ev, prior_mids)
    if market is None:
        return None
    fair = hold.hit_rate(prior_mids, market)
    if post.edge(fair, float(market["shown"]) + float(market["tick"]), float(market["rate"])) <= 0:
        return None
    return market, fair


def run(data):
    return hold.finish(data, choose, hold.mids_before, "VAR", "reviews/2026-09-25-polymarket-fp5-prereg-var.md")


def _mkt(lo, hi, shown, condition, payout=0.0, rate=0.0, tick=0.01):
    return {
        "condition": condition, "lo": lo, "hi": hi, "shown": shown, "tick": tick, "rate": rate,
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
            "closed": start - (i + 1) * 86400, "winner_mid": 50.0,
            "markets": [_mkt(40, 59, 0.5, "w", payout=1.0)],
        })
    markets = [_mkt(0, 19, 0.10, "wing"), _mkt(40, 59, 0.50, "mid", payout=1.0), _mkt(80, 99, 0.10, "other")]
    buy = [[td + 10, "BUY", 0, 0.50, 40.0]]
    ev = {
        "slug": "var-example", "series": 10000, "days": 7, "start": start, "end": end, "closed": end,
        "winner_mid": 50.0, "markets": markets, "picked": {"condition": "mid", "prints": buy},
    }
    trades, counts, _ = hold.trades_from(priors + [ev], choose, hold.mids_before)
    if len(trades) != 1 or trades[0]["lo"] != 40 or abs(trades[0]["fills"][0][1] - 0.51) > 1e-9:
        raise SystemExit("var pin %s %s" % (trades, counts))
    sh = 10.0 / 0.51
    hand = sh * (1.0 - 0.51)
    if abs(post.pnl_of(trades[0]) - hand) > 1e-6 or abs(hand - 9.607843) > 1e-6:
        raise SystemExit("pnl %s != %s" % (post.pnl_of(trades[0]), hand))
    wide = dict(ev)
    wide["markets"] = [_mkt(0, 19, 0.05, "lo"), _mkt(40, 59, 0.80, "mid"), _mkt(200, 219, 0.05, "far")]
    wide_mids = [0.0] * 4 + [100.0] * 4
    got = target(wide, wide_mids)
    if got is None or got["lo"] != 200:
        raise SystemExit("a cheap book did not name the far bracket %s" % got)
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
