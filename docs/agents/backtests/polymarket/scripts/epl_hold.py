"""Hold-to-settlement book for the fp5 Premier League rules.

The rule is the caller's choose(). This file walks taker prints and scores
the six conditions. It does not choose a side.
"""
import json
from collections import defaultdict
from datetime import datetime, timezone

import post_test as post


def trades_from(events, scores, choose):
    counts = defaultdict(int)
    incomplete = 0
    out = []
    for ev in events or []:
        end = ev.get("end")
        if end is None or post.window_of(float(end)) is None:
            counts["outside_window"] += 1
            continue
        counts["events"] += 1
        chosen = choose(ev, scores)
        stored = ev.get("picked")
        stored_side = None if not stored else stored.get("side")
        picked_side = None if chosen is None else chosen[0]
        if stored_side != picked_side:
            raise SystemExit(
                "picked side mismatch on %s: rule %s, pull %s" % (ev.get("slug"), picked_side, stored_side)
            )
        if chosen is None:
            counts["no_trade"] += 1
            continue
        side, fair = chosen
        market = (ev.get("markets") or {}).get(side)
        if market is None or stored.get("condition") != market.get("condition"):
            raise SystemExit("picked condition mismatch on %s" % ev.get("slug"))
        if stored.get("prints") == "incomplete":
            incomplete += 1
            counts["prints_incomplete"] += 1
            continue
        fills = post.walk_buys(
            stored.get("prints") or [], float(market["shown"]), float(market["tick"]), float(market["rate"]), fair,
        )
        if not fills:
            counts["under_min_fill"] += 1
            continue
        bought = sum(qty for _, _, qty in fills)
        closed = float(market.get("closed") or ev.get("closed") or end)
        counts["filled"] += 1
        out.append({
            "slug": ev["slug"], "series": ev.get("series"), "side": side,
            "fair": fair, "shown": float(market["shown"]),
            "fills": fills, "sells": [], "unsold": bought,
            "first": fills[0][0], "payout": float(market["payout_yes"]), "end": float(end),
            "closed": closed, "rate": float(market["rate"]), "tick": float(market["tick"]),
            "release": closed,
        })
    out.sort(key=lambda c: (c["first"], c["slug"]))
    return out, dict(counts), incomplete


def finish(data, choose, rule, prereg):
    trades, counts, incomplete = trades_from(data.get("events"), data.get("scores"), choose)
    out = post.evaluate(trades, incomplete)
    out["counts"] = counts
    return {"rule": rule, "prereg": prereg, "result": out}


def market(side, shown, payout=0.0, rate=0.05, tick=0.001, end=None):
    return {
        "condition": "cond-%s" % side, "shown": shown, "tick": tick, "rate": rate,
        "payout_yes": payout, "closed": end,
    }


def pack(slug, end, home, away, markets, side, prints):
    picked = None
    if side is not None:
        picked = {"side": side, "condition": markets[side]["condition"], "prints": prints}
    return {
        "slug": slug, "series": 10188, "end": end, "closed": end + 3 * 3600,
        "home": home, "away": away, "markets": markets, "picked": picked,
    }


def hand_pnl(shown, tick, rate, payout, print_px=0.10, size=100.0):
    """One taker buy, floored one tick through the shown price, held to settlement."""
    px = max(print_px, shown + tick)
    sh = post.STAKE / px
    fee = rate * px * (1.0 - px)
    return sh * (payout - px) - fee * sh, px


def assert_book(choose, scores, ev, side, fair):
    trades, counts, incomplete = trades_from([ev], scores, choose)
    if incomplete or len(trades) != 1 or trades[0]["side"] != side:
        raise SystemExit("book %s %s" % (counts, trades))
    if abs(trades[0]["fair"] - fair) > 1e-9:
        raise SystemExit("fair %s != %s" % (trades[0]["fair"], fair))
    shown = float(ev["markets"][side]["shown"])
    tick = float(ev["markets"][side]["tick"])
    rate = float(ev["markets"][side]["rate"])
    payout = float(ev["markets"][side]["payout_yes"])
    hand, px = hand_pnl(shown, tick, rate, payout)
    if abs(trades[0]["fills"][0][1] - px) > 1e-12:
        raise SystemExit("fill %s != %s" % (trades[0]["fills"][0][1], px))
    if abs(post.pnl_of(trades[0]) - hand) > 1e-6:
        raise SystemExit("pnl %s != %s" % (post.pnl_of(trades[0]), hand))
    return trades[0], hand


def day0():
    return datetime(2025, 9, 1, 15, 0, tzinfo=timezone.utc).timestamp()


def played(day, home, away, hg, ag, origin=None):
    origin = day0() if origin is None else origin
    return {"kick": origin + day * 86400.0, "home": home, "away": away, "hg": hg, "ag": ag}


def rich_board(shown_h, payout_h, end, rate=0.05):
    """Home is the cheap side. Draw and away are priced where a fair value under 1 has no edge."""
    return {
        "H": market("H", shown_h, payout=payout_h, rate=rate, end=end),
        "D": market("D", 0.80, payout=0.0, rate=rate, end=end),
        "A": market("A", 0.80, payout=0.0, rate=rate, end=end),
    }


def prints_for(end):
    td = float(end) - 3600.0
    return [[td + 10, "BUY", 0, 0.10, 100.0]]
