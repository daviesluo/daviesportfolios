"""POISSON: one post-count bracket versus a Poisson at the prior mean (fp5).

Not POST and not HITS. The fill walk is post_test.walk_buys.
Reads the committed gzip. `--self-check` does not read a file.

usage: poisson_test.py --self-check
       poisson_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import math
import sys
from collections import defaultdict

import post_test as post

MIN_PRIOR = post.MIN_PRIOR


def bracket_prob(lam, lo, hi):
    """P(lo <= K <= hi) for K ~ Poisson(lam). An open bracket sums out to lam + 12 standard deviations."""
    lam = float(lam)
    if lam <= 0:
        return 1.0 if int(lo) == 0 else 0.0
    cap = max(int(lo), int(math.ceil(lam + 12.0 * math.sqrt(lam) + 30.0)))
    end = cap if hi is None else int(hi)
    if end < int(lo):
        return 0.0
    # log pmf at lo, then recur. A closed bracket stops at hi. An open one stops at the cap;
    # the missing tail past the cap is far below a tick.
    log_p = -lam + int(lo) * math.log(lam) - math.lgamma(int(lo) + 1)
    total = 0.0
    p = math.exp(log_p) if log_p > -700 else 0.0
    k = int(lo)
    total += p
    while k < end:
        k += 1
        p *= lam / k
        total += p
    return min(1.0, total)


def choose(ev, prior_mids):
    if len(prior_mids) < MIN_PRIOR:
        return None
    markets = [m for m in (ev.get("markets") or []) if m.get("lo") is not None and m.get("shown") is not None]
    if not markets:
        return None
    lam = sum(prior_mids) / float(len(prior_mids))
    best = None
    for m in markets:
        fair = bracket_prob(lam, m["lo"], m["hi"])
        gap = post.edge(fair, float(m["shown"]) + float(m["tick"]), float(m["rate"]))
        if gap <= 0:
            continue
        key = (-gap, int(m["lo"]), str(m.get("condition") or ""))
        if best is None or key < best[0]:
            best = (key, m, fair)
    if best is None:
        return None
    return best[1], best[2]


def _priors_for(ev, events):
    td = post.decision_time(ev)
    out = []
    for other in events:
        if other.get("series") != ev.get("series") or other.get("days") != ev.get("days"):
            continue
        if other.get("winner_mid") is None or float(other["end"]) > td:
            continue
        out.append(float(other["winner_mid"]))
    return out


def trades_from(events):
    counts = defaultdict(int)
    incomplete = 0
    out = []
    rows = list(events or [])
    for ev in rows:
        end = float(ev["end"])
        if post.window_of(end) is None:
            counts["outside_window"] += 1
            continue
        if ev.get("days") is None or ev.get("start") is None:
            counts["no_span"] += 1
            continue
        counts["events"] += 1
        priors = _priors_for(ev, rows)
        chosen = choose(ev, priors)
        stored = ev.get("picked")
        stored_id = None if not stored else stored.get("condition")
        picked_id = None if chosen is None else chosen[0].get("condition")
        if stored_id != picked_id:
            raise SystemExit("picked bracket mismatch on %s: rule %s, pull %s" % (ev.get("slug"), picked_id, stored_id))
        if chosen is None:
            counts["no_trade"] += 1
            continue
        market, fair = chosen
        if stored.get("prints") == "incomplete":
            incomplete += 1
            counts["prints_incomplete"] += 1
            continue
        fills = post.walk_buys(stored.get("prints") or [], float(market["shown"]), float(market["tick"]), float(market["rate"]), fair)
        if not fills:
            counts["under_min_fill"] += 1
            continue
        bought = sum(qty for _, _, qty in fills)
        counts["filled"] += 1
        out.append({
            "slug": ev["slug"], "series": ev.get("series"), "lo": market["lo"], "hi": market["hi"],
            "fair": fair, "shown": float(market["shown"]),
            "fills": fills, "sells": [], "unsold": bought,
            "first": fills[0][0], "payout": float(market["payout_yes"]), "end": end,
            "closed": float(market.get("closed") or ev.get("closed") or end),
            "rate": float(market["rate"]), "tick": float(market["tick"]),
            "release": float(market.get("closed") or ev.get("closed") or end),
        })
    out.sort(key=lambda c: (c["first"], c["slug"]))
    return out, dict(counts), incomplete


def run(data):
    trades, counts, incomplete = trades_from(data.get("events"))
    out = post.evaluate(trades, incomplete)
    out["counts"] = counts
    return {"rule": "POISSON", "prereg": "reviews/2026-09-25-polymarket-fp5-prereg-poisson.md", "result": out}


def _mkt(lo, hi, shown, condition, payout=0.0):
    return {
        "condition": condition, "lo": lo, "hi": hi, "shown": shown, "tick": 0.001, "rate": 0.05,
        "payout_yes": payout, "closed": None,
    }


def self_check():
    closed = bracket_prob(2.0, 2, 3)
    hand_p = math.exp(-2) * (2.0 ** 2 / 2 + 2.0 ** 3 / 6)
    if abs(closed - hand_p) > 1e-9:
        raise SystemExit("poisson %s != %s" % (closed, hand_p))
    end = post.T_OOS1 + 20 * 86400
    start = end - 10 * 86400
    td = start + post.OPEN_LAG
    priors = []
    for i in range(MIN_PRIOR):
        priors.append({
            "slug": "p%s" % i, "series": 10000, "days": 7,
            "start": start - (i + 2) * 10 * 86400, "end": start - (i + 1) * 86400,
            "closed": start - (i + 1) * 86400, "winner_mid": 2.0,
            "markets": [_mkt(2, 3, 0.2, "w", payout=1.0)],
        })
    markets = [_mkt(0, 1, 0.50, "a"), _mkt(2, 3, 0.20, "b", payout=1.0), _mkt(4, None, 0.30, "c")]
    buy = [[td + 10, "BUY", 0, 0.10, 200.0]]
    ev = {
        "slug": "poisson-example", "series": 10000, "days": 7, "start": start, "end": end, "closed": end,
        "winner_mid": 2.0, "markets": markets, "picked": {"condition": "b", "prints": buy},
    }
    trades, counts, _ = trades_from(priors + [ev])
    if len(trades) != 1 or trades[0]["lo"] != 2 or abs(trades[0]["fills"][0][1] - 0.201) > 1e-9:
        raise SystemExit("poisson pin %s %s" % (trades, counts))
    sh = 10.0 / 0.201
    hand = sh * (1.0 - 0.201) - post.fee(0.05, 0.201) * sh
    if abs(post.pnl_of(trades[0]) - hand) > 1e-6:
        raise SystemExit("pnl %s != %s" % (post.pnl_of(trades[0]), hand))
    print("self-check ok", round(hand, 6))


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--self-check":
        self_check()
    else:
        with gzip.open(sys.argv[1], "rt") as f:
            data = json.load(f)
        out = run(data)
        with open(sys.argv[2], "w") as f:
            json.dump(out, f, indent=2, sort_keys=True)
            f.write("\n")
        print("passes", out["result"]["passes"], "oos", out["result"]["OOS"], "bar", out["result"]["bar"])
