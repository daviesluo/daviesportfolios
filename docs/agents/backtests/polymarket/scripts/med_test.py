"""MED: buy the post-count bracket that contains the median of past winning midpoints (fp5).

Not HITS: the bracket is chosen by the median before its price is compared, and a
cheaper bracket is not eligible. Not POST: no flat-book filter and no early sale.
The fill walk is post_test.walk_buys. `--self-check` does not read a file.

usage: med_test.py --self-check
       med_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys

import ladder_hold as hold
import post_test as post

MIN_PRIOR = post.MIN_PRIOR


def choose(ev, prior_mids):
    if len(prior_mids) < MIN_PRIOR:
        return None
    markets = hold.priced(ev)
    if not markets:
        return None
    market = hold.bracket_containing(markets, hold.median(prior_mids))
    if market is None:
        return None
    fair = hold.hit_rate(prior_mids, market)
    if post.edge(fair, float(market["shown"]) + float(market["tick"]), float(market["rate"])) <= 0:
        return None
    return market, fair


def run(data):
    return hold.finish(data, choose, hold.mids_before, "MED", "reviews/2026-09-25-polymarket-fp5-prereg-med.md")


def _mkt(lo, hi, shown, condition, payout=0.0, rate=0.05):
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
            "closed": start - (i + 1) * 86400, "winner_mid": 45.0,
            "markets": [_mkt(40, 59, 0.2, "w", payout=1.0)],
        })
    markets = [_mkt(0, 19, 0.02, "cheap"), _mkt(40, 59, 0.20, "mid", payout=1.0)]
    buy = [[td + 10, "BUY", 0, 0.19, 200.0]]
    ev = {
        "slug": "med-example", "series": 10000, "days": 7, "start": start, "end": end, "closed": end,
        "winner_mid": 45.0, "markets": markets, "picked": {"condition": "mid", "prints": buy},
    }
    trades, counts, _ = hold.trades_from(priors + [ev], choose, hold.mids_before)
    if len(trades) != 1 or trades[0]["lo"] != 40 or abs(trades[0]["fills"][0][1] - 0.201) > 1e-9:
        raise SystemExit("med pin %s %s" % (trades, counts))
    sh = 10.0 / 0.201
    hand = sh * (1.0 - 0.201) - post.fee(0.05, 0.201) * sh
    if abs(post.pnl_of(trades[0]) - hand) > 1e-6 or abs(hand - 39.351744) > 1e-6:
        raise SystemExit("pnl %s != %s" % (post.pnl_of(trades[0]), hand))
    if choose(ev, [45.0] * 8)[0]["condition"] != "mid":
        raise SystemExit("the cheap bracket was eligible")
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
