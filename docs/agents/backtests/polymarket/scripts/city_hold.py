"""Hold-to-settlement book for the fp5 temperature rules.

The rule is the caller's choose(). Prices and prints are the committed weather
file. The fee is the weather schedule, 0.05. A forecast field is never read.
`--self-check` in each rule does not read a file.
"""
from collections import defaultdict
from datetime import datetime, timezone

import post_test as post

FEE = 0.05
MIN_PRIOR = 8
MAX_LAG_DAYS = 3


def date_ts(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc).timestamp()


def days_between(earlier, later):
    a = datetime.fromisoformat(earlier)
    b = datetime.fromisoformat(later)
    return (b - a).days


def key_of(ev):
    return (ev.get("city"), ev.get("hl"), ev.get("unit"))


def winner_market(ev):
    best = None
    for m in ev.get("markets") or []:
        pay = m.get("payout_yes")
        if pay is None:
            continue
        key = (-float(pay), str(m.get("cond") or ""))
        if best is None or key < best[0]:
            best = (key, m)
    if best is None or float(best[1]["payout_yes"]) < 0.99:
        return None
    return best[1]


def mid_of(market):
    if market is None:
        return None
    lo, hi = market["iv"][0], market["iv"][1]
    if lo is None and hi is None:
        return None
    if lo is None:
        return float(hi)
    if hi is None:
        return float(lo)
    return (float(lo) + float(hi)) / 2.0


def norm_iv(iv):
    lo, hi = iv[0], iv[1]
    return (None if lo is None else float(lo), None if hi is None else float(hi))


def same_iv(a, b):
    return norm_iv(a) == norm_iv(b)


def contains_iv(iv, value):
    lo, hi = norm_iv(iv)
    if lo is not None and float(value) < lo - 1e-9:
        return False
    if hi is not None and float(value) > hi + 1e-9:
        return False
    return True


def median(xs):
    ys = sorted(float(x) for x in xs)
    n = len(ys)
    if n % 2:
        return ys[n // 2]
    return (ys[n // 2 - 1] + ys[n // 2]) / 2.0


def known_priors(ev, events):
    """Same city, kind and unit, already resolved at this event's decision time."""
    td = ev.get("td")
    if td is None:
        return []
    td = float(td)
    out = []
    for other in events:
        if other is ev or key_of(other) != key_of(ev):
            continue
        if not other.get("date") or not ev.get("date") or other["date"] >= ev["date"]:
            continue
        won = winner_market(other)
        if won is None or won.get("closed") is None or float(won["closed"]) > td:
            continue
        out.append(other)
    out.sort(key=lambda row: (row["date"], str(row.get("event"))))
    return out


def tradable(ev, market):
    td = ev.get("td")
    if td is None or market.get("p") is None:
        return False
    start, closed = market.get("start"), market.get("closed")
    if not (start and closed and float(start) < float(td) < float(closed)):
        return False
    return True


def match_iv(markets, iv):
    hits = [m for m in markets if m.get("iv") is not None and same_iv(m["iv"], iv)]
    if not hits:
        return None
    hits.sort(key=lambda m: str(m.get("cond") or ""))
    return hits[0]


def containing(markets, value):
    hits = [m for m in markets if m.get("iv") is not None and contains_iv(m["iv"], value)]
    if not hits:
        return None

    def key(m):
        lo = m["iv"][0]
        return (lo is not None, 0.0 if lo is None else float(lo), str(m.get("cond") or ""))

    hits.sort(key=key)
    return hits[0]


def ordered(markets):
    def key(m):
        lo = m["iv"][0]
        return (lo is not None, 0.0 if lo is None else float(lo), str(m.get("cond") or ""))

    return sorted([m for m in markets if m.get("iv") is not None], key=key)


def hour_prints(ev, market):
    td = float(ev["td"])
    out = []
    for row in market.get("prints") or []:
        ts = float(row[0])
        if td < ts <= td + 3600:
            out.append(row)
    return out


def trades_from(events, choose):
    counts = defaultdict(int)
    incomplete = 0
    out = []
    rows = list(events or [])
    for ev in rows:
        if not ev.get("date") or ev.get("td") is None:
            counts["no_clock"] += 1
            continue
        end = date_ts(ev["date"])
        if post.window_of(end) is None:
            counts["outside_window"] += 1
            continue
        counts["events"] += 1
        priors = known_priors(ev, rows)
        chosen = choose(ev, priors)
        if chosen is None:
            counts["no_trade"] += 1
            continue
        market, fair = chosen
        if not tradable(ev, market):
            counts["not_open"] += 1
            continue
        if not ev.get("prints_pulled") or not ev.get("prints_complete"):
            incomplete += 1
            counts["prints_incomplete"] += 1
            continue
        tick = float(market.get("tick") or 0.01)
        fills = post.walk_buys(hour_prints(ev, market), float(market["p"]), tick, FEE, fair)
        if not fills:
            counts["under_min_fill"] += 1
            continue
        bought = sum(qty for _, _, qty in fills)
        counts["filled"] += 1
        out.append({
            "slug": str(ev.get("event")), "city": ev.get("city"), "hl": ev.get("hl"),
            "lo": market["iv"][0], "hi": market["iv"][1],
            "fair": fair, "shown": float(market["p"]),
            "fills": fills, "sells": [], "unsold": bought,
            "first": fills[0][0], "payout": float(market["payout_yes"]), "end": end,
            "closed": float(market.get("closed") or end),
            "rate": FEE, "tick": tick,
            "release": float(market.get("closed") or end),
        })
    out.sort(key=lambda c: (c["first"], c["slug"], str(c["lo"])))
    return out, dict(counts), incomplete


def finish(data, choose, rule, prereg):
    trades, counts, incomplete = trades_from(data.get("events"), choose)
    out = post.evaluate(trades, incomplete)
    out["counts"] = counts
    return {"rule": rule, "prereg": prereg, "result": out}
