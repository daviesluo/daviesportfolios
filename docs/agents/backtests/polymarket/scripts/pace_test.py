"""PACE: with 48 hours left, buy the post-count bracket the tracker pace points at (fp5).

The elapsed count is the tracker's posts, not a price history. The fill walk is post_test.walk_buys.
Reads the committed gzip. `--self-check` does not read a file.

usage: pace_test.py --self-check
       pace_test.py <inputs.json.gz> <out.json>
"""
import gzip
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone

import post_test as post

MIN_PRIOR = post.MIN_PRIOR
REMAINING = 48 * 3600
HANDLES = {10000: ("elonmusk", "x"), 11108: ("realDonaldTrump", "truth_social")}


def pace_time(ev):
    return float(ev["end"]) - REMAINING


def window_start(ev):
    return float(ev["end"]) - int(ev["days"]) * 86400


def so_far_and_final(times, start, cut, end):
    """Posts created inside the window. The live count also has to have been imported by the cut."""
    so_far = 0
    final = 0
    for created, imported in times or []:
        created = float(created)
        imported = float(imported)
        if start <= created <= end:
            final += 1
            if created <= cut and imported <= cut:
                so_far += 1
    return so_far, final


def _bracket_for(markets, value):
    hits = [m for m in markets if m.get("lo") is not None and post.contains(m["lo"], m["hi"], value)]
    if not hits:
        return None
    hits.sort(key=lambda m: (int(m["lo"]), str(m.get("condition") or "")))
    return hits[0]


def choose(ev, priors):
    """priors are dicts {final, remainder} already restricted to resolved same-span windows."""
    if len(priors) < MIN_PRIOR:
        return None
    if ev.get("so_far") is None:
        return None
    markets = [m for m in (ev.get("markets") or []) if m.get("lo") is not None and m.get("shown") is not None]
    if not markets:
        return None
    mean_rem = sum(p["remainder"] for p in priors) / float(len(priors))
    forecast = float(ev["so_far"]) + mean_rem
    market = _bracket_for(markets, forecast)
    if market is None:
        return None
    n = float(len(priors))
    fair = sum(1 for p in priors if post.contains(market["lo"], market["hi"], p["final"])) / n
    if post.edge(fair, float(market["shown"]) + float(market["tick"]), float(market["rate"])) <= 0:
        return None
    return market, fair


def derived(ev):
    so_far, final = so_far_and_final(ev.get("times"), window_start(ev), pace_time(ev), float(ev["end"]))
    return so_far, final, final - so_far


def _priors_for(ev, events):
    cut = pace_time(ev)
    out = []
    for other in events:
        if other.get("series") != ev.get("series") or other.get("days") != ev.get("days"):
            continue
        if not isinstance(other.get("times"), list) or float(other["end"]) > cut:
            continue
        _so_far, final, rem = derived(other)
        out.append({"final": float(final), "remainder": float(rem)})
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
        if ev.get("days") is None or pace_time(ev) <= window_start(ev):
            counts["no_span"] += 1
            continue
        counts["events"] += 1
        if ev.get("times") == "incomplete":
            incomplete += 1
            counts["tracker_incomplete"] += 1
            continue
        if not isinstance(ev.get("times"), list):
            counts["no_tracker"] += 1
            continue
        so_far, final, _rem = derived(ev)
        if ev.get("so_far") is not None and int(ev["so_far"]) != so_far:
            raise SystemExit("so_far mismatch on %s" % ev.get("slug"))
        ev = dict(ev)
        ev["so_far"] = so_far
        ev["final"] = final
        ev["remainder"] = final - so_far
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
    return {"rule": "PACE", "prereg": "reviews/2026-09-25-polymarket-fp5-prereg-pace.md", "result": out}


def self_check():
    assert HANDLES[10000][0] == "elonmusk"
    assert HANDLES[11108][1] == "truth_social"
    end = post.T_OOS1 + 20 * 86400
    start_w = end - 7 * 86400
    cut = end - REMAINING
    # 10 posts imported before the cut, 4 more before the end.
    times = []
    for i in range(10):
        t = start_w + 3600 * (i + 1)
        times.append([t, t])
    for i in range(4):
        t = cut + 3600 * (i + 1)
        times.append([t, t])
    so_far, final = so_far_and_final(times, start_w, cut, end)
    if (so_far, final) != (10, 14):
        raise SystemExit("count pin %s %s" % (so_far, final))
    # A post imported after the cut is not in the live count.
    late = list(times) + [[cut - 10, cut + 10]]
    so_far2, final2 = so_far_and_final(late, start_w, cut, end)
    if so_far2 != 10 or final2 != 15:
        raise SystemExit("import pin %s %s" % (so_far2, final2))

    priors = []
    for i in range(MIN_PRIOR):
        pend = end - (i + 2) * 10 * 86400
        pstart = pend - 7 * 86400
        pcut = pend - REMAINING
        ptimes = [[pstart + 3600 * (k + 1), pstart + 3600 * (k + 1)] for k in range(10)]
        ptimes += [[pcut + 3600 * (k + 1), pcut + 3600 * (k + 1)] for k in range(4)]
        priors.append({
            "slug": "p%s" % i, "series": 10000, "days": 7, "start": pend - 8 * 86400, "end": pend,
            "closed": pend, "so_far": 10, "times": ptimes,
            "markets": [{"condition": "w", "lo": 12, "hi": 16, "shown": 0.2, "tick": 0.001, "rate": 0.05,
                         "payout_yes": 1.0, "closed": pend}],
        })
    market = {"condition": "b", "lo": 12, "hi": 16, "shown": 0.20, "tick": 0.001, "rate": 0.05,
              "payout_yes": 1.0, "closed": end}
    ev = {
        "slug": "pace-example", "series": 10000, "days": 7, "start": start_w - 86400, "end": end,
        "closed": end, "times": times, "so_far": 10, "final": 14, "remainder": 4,
        "markets": [market, {"condition": "a", "lo": 0, "hi": 11, "shown": 0.40, "tick": 0.001, "rate": 0.05,
                             "payout_yes": 0.0, "closed": end}],
        "picked": {"condition": "b", "prints": [[cut + 10, "BUY", 0, 0.10, 200.0]]},
    }
    trades, counts, _ = trades_from(priors + [ev])
    if len(trades) != 1 or trades[0]["lo"] != 12 or abs(trades[0]["fills"][0][1] - 0.201) > 1e-9:
        raise SystemExit("pace pin %s %s" % (trades, counts))
    # forecast = 10 + 4 = 14, inside 12-16. fair = 1. 
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
