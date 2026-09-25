"""RICH: buy NO on the dearest post-count bracket when its hit rate is below the price (fp5).

The crowd's modal bracket is the only candidate. The NO token is bought when
one minus the historical hit rate clears the NO price. A shown YES price at or
outside (0.10, 0.90) is not a trade: that NO or YES token is the favourite
entry that already failed. Not HITS, not TAIL, not FAV. `--self-check` does
not read a file.

usage: rich_test.py --self-check
       rich_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys
from collections import defaultdict

import ladder_hold as hold
import post_test as post

MIN_PRIOR = post.MIN_PRIOR


def _mode(markets):
    return min(markets, key=lambda m: (-float(m["shown"]), int(m["lo"]), str(m.get("condition") or "")))


def choose(ev, prior_mids):
    if len(prior_mids) < MIN_PRIOR:
        return None
    markets = hold.priced(ev)
    if not markets:
        return None
    market = _mode(markets)
    shown = float(market["shown"])
    if not (0.10 < shown < 0.90):
        return None
    fair_no = 1.0 - hold.hit_rate(prior_mids, market)
    if post.edge(fair_no, (1.0 - shown) + float(market["tick"]), float(market["rate"])) <= 0:
        return None
    return market, fair_no


def walk_no(prints, shown_yes, tick, rate, fair_no):
    shown_no = 1.0 - float(shown_yes)
    remaining, fills = post.STAKE, []
    for ts, sd, oi, price, size in prints:
        if oi == 1 and sd == "BUY":
            ptok = price
        elif oi == 0 and sd == "SELL":
            ptok = 1.0 - price
        else:
            continue
        px = max(ptok, shown_no + tick)
        if px > post.LIMIT + 1e-12:
            continue
        if post.edge(fair_no, px, rate) <= 0:
            continue
        qty = min(size, remaining / px)
        if qty <= 0:
            break
        fills.append((float(ts), px, qty))
        remaining -= qty * px
        if remaining <= 1e-9:
            break
    if post.STAKE - remaining < post.MIN_FILL:
        return None
    return fills


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
        priors = hold.mids_before(ev, rows)
        chosen = choose(ev, priors)
        stored = ev.get("picked")
        stored_id = None if not stored else stored.get("condition")
        picked_id = None if chosen is None else chosen[0].get("condition")
        if stored_id != picked_id:
            raise SystemExit("picked bracket mismatch on %s: rule %s, pull %s" % (ev.get("slug"), picked_id, stored_id))
        if chosen is None:
            counts["no_trade"] += 1
            continue
        market, fair_no = chosen
        if stored.get("prints") == "incomplete":
            incomplete += 1
            counts["prints_incomplete"] += 1
            continue
        fills = walk_no(stored.get("prints") or [], float(market["shown"]), float(market["tick"]), float(market["rate"]), fair_no)
        if not fills:
            counts["under_min_fill"] += 1
            continue
        bought = sum(qty for _, _, qty in fills)
        counts["filled"] += 1
        out.append({
            "slug": ev["slug"], "series": ev.get("series"), "lo": market["lo"], "hi": market["hi"],
            "fair": fair_no, "shown": float(market["shown"]), "side": "NO",
            "fills": fills, "sells": [], "unsold": bought,
            "first": fills[0][0], "payout": 1.0 - float(market["payout_yes"]), "end": end,
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
    return {"rule": "RICH", "prereg": "reviews/2026-09-25-polymarket-fp5-prereg-rich.md", "result": out}


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
        mid = 50.0 if i < 2 else 90.0
        priors.append({
            "slug": "p%s" % i, "series": 10000, "days": 7,
            "start": start - (i + 2) * 10 * 86400, "end": start - (i + 1) * 86400,
            "closed": start - (i + 1) * 86400, "winner_mid": mid,
            "markets": [_mkt(40, 59, 0.2, "w", payout=1.0)],
        })
    markets = [_mkt(40, 59, 0.60, "mode", payout=0.0), _mkt(80, 99, 0.20, "other")]
    buy = [[td + 10, "BUY", 1, 0.30, 80.0]]
    ev = {
        "slug": "rich-example", "series": 10000, "days": 7, "start": start, "end": end, "closed": end,
        "winner_mid": 90.0, "markets": markets, "picked": {"condition": "mode", "prints": buy},
    }
    trades, counts, _ = trades_from(priors + [ev])
    if len(trades) != 1 or trades[0]["lo"] != 40 or abs(trades[0]["fills"][0][1] - 0.401) > 1e-9:
        raise SystemExit("rich pin %s %s" % (trades, counts))
    sh = 10.0 / 0.401
    hand = sh * (1.0 - 0.401) - post.fee(0.05, 0.401) * sh
    if abs(post.pnl_of(trades[0]) - hand) > 1e-6 or abs(hand - 14.638156) > 1e-6:
        raise SystemExit("pnl %s != %s" % (post.pnl_of(trades[0]), hand))
    fav = dict(ev)
    fav["markets"] = [_mkt(40, 59, 0.05, "mode"), _mkt(80, 99, 0.02, "other")]
    fav["picked"] = None
    if trades_from(priors + [fav])[0]:
        raise SystemExit("a favourite NO price was traded")
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
