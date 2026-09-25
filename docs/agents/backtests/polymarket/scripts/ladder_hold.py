"""Hold-to-settlement book shared by the fp5 ladder rules that buy YES.

The rule is the caller's choose(). This file only checks the stored pick,
walks taker prints and scores the six conditions. It does not choose a bracket.
"""
import json
from collections import defaultdict

import post_test as post


def trades_from(events, choose, priors_for):
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
        priors = priors_for(ev, rows)
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
        fills = post.walk_buys(
            stored.get("prints") or [], float(market["shown"]), float(market["tick"]), float(market["rate"]), fair,
        )
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


def finish(data, choose, priors_for, rule, prereg):
    trades, counts, incomplete = trades_from(data.get("events"), choose, priors_for)
    out = post.evaluate(trades, incomplete)
    out["counts"] = counts
    return {"rule": rule, "prereg": prereg, "result": out}


def mids_before(ev, events):
    td = post.decision_time(ev)
    out = []
    for other in events:
        if other.get("series") != ev.get("series") or other.get("days") != ev.get("days"):
            continue
        if other.get("winner_mid") is None or float(other["end"]) > td:
            continue
        out.append(float(other["winner_mid"]))
    return out


def priced(ev):
    return [m for m in (ev.get("markets") or []) if m.get("lo") is not None and m.get("shown") is not None]


def bracket_containing(markets, value):
    hits = [m for m in markets if post.contains(m["lo"], m["hi"], value)]
    if not hits:
        return None
    hits.sort(key=lambda m: (int(m["lo"]), str(m.get("condition") or "")))
    return hits[0]


def hit_rate(mids, market):
    if not mids:
        return 0.0
    return sum(1 for x in mids if post.contains(market["lo"], market["hi"], x)) / float(len(mids))


def median(xs):
    ys = sorted(float(x) for x in xs)
    n = len(ys)
    if n % 2:
        return ys[n // 2]
    return (ys[n // 2 - 1] + ys[n // 2]) / 2.0


def write_result(path, payload):
    with open(path, "w") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
        f.write("\n")
