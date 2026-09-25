"""HITS: the post-count bracket whose historical hit rate clears its price by the most (fp5).

Not POST. No flat-book filter and no early sale. The fill walk is post_test.walk_buys.
Reads the committed gzip. `--self-check` does not read a file.

usage: hits_test.py --self-check
       hits_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys
from collections import defaultdict

import post_test as post

MIN_PRIOR = post.MIN_PRIOR


def choose(ev, prior_mids):
    """The bracket with the largest positive edge of its hit rate over the shown price."""
    if len(prior_mids) < MIN_PRIOR:
        return None
    markets = [m for m in (ev.get("markets") or []) if m.get("lo") is not None and m.get("shown") is not None]
    if not markets:
        return None
    n = float(len(prior_mids))
    best = None
    for m in markets:
        frac = sum(1 for x in prior_mids if post.contains(m["lo"], m["hi"], x)) / n
        gap = post.edge(frac, float(m["shown"]) + float(m["tick"]), float(m["rate"]))
        if gap <= 0:
            continue
        key = (-gap, int(m["lo"]), str(m.get("condition") or ""))
        if best is None or key < best[0]:
            best = (key, m, frac)
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
        market, frac = chosen
        if stored.get("prints") == "incomplete":
            incomplete += 1
            counts["prints_incomplete"] += 1
            continue
        fills = post.walk_buys(stored.get("prints") or [], float(market["shown"]), float(market["tick"]), float(market["rate"]), frac)
        if not fills:
            counts["under_min_fill"] += 1
            continue
        bought = sum(qty for _, _, qty in fills)
        counts["filled"] += 1
        out.append({
            "slug": ev["slug"], "series": ev.get("series"), "lo": market["lo"], "hi": market["hi"],
            "fair": frac, "shown": float(market["shown"]),
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
    return {"rule": "HITS", "prereg": "reviews/2026-09-25-polymarket-fp5-prereg-hits.md", "result": out}


def _mkt(lo, hi, shown, condition, payout=0.0):
    return {
        "condition": condition, "lo": lo, "hi": hi, "shown": shown, "tick": 0.001, "rate": 0.05,
        "payout_yes": payout, "closed": None,
    }


def self_check():
    end = post.T_OOS1 + 20 * 86400
    start = end - 10 * 86400
    td = start + post.OPEN_LAG
    priors = []
    for i in range(MIN_PRIOR):
        mid = 49.5 if i < 4 else 69.5
        priors.append({
            "slug": "p%s" % i, "series": 10000, "days": 7,
            "start": start - (i + 2) * 10 * 86400, "end": start - (i + 1) * 86400,
            "closed": start - (i + 1) * 86400, "winner_mid": mid,
            "markets": [_mkt(40, 59, 0.2, "w", payout=1.0)],
        })
    markets = [_mkt(40, 59, 0.48, "a"), _mkt(60, 79, 0.10, "b", payout=1.0)]
    buy = [[td + 10, "BUY", 0, 0.05, 200.0]]
    ev = {
        "slug": "hits-example", "series": 10000, "days": 7, "start": start, "end": end, "closed": end,
        "winner_mid": 49.5, "markets": markets,
        "picked": {"condition": "b", "prints": buy},
    }
    trades, counts, _ = trades_from(priors + [ev])
    if len(trades) != 1 or trades[0]["lo"] != 60 or abs(trades[0]["fills"][0][1] - 0.101) > 1e-9:
        raise SystemExit("hits pin %s %s" % (trades, counts))
    sh = 10.0 / 0.101
    hand = sh * (1.0 - 0.101) - post.fee(0.05, 0.101) * sh
    if abs(post.pnl_of(trades[0]) - hand) > 1e-6:
        raise SystemExit("pnl %s != %s" % (post.pnl_of(trades[0]), hand))
    # The mode is not required: 40-59 is the lower bracket and is not the pick.
    if choose(ev, [49.5] * 4 + [69.5] * 4)[0]["condition"] != "b":
        raise SystemExit("a tie on the hit rate must take the larger edge")
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
