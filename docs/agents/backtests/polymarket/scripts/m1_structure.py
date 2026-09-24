"""M1: what the live venue looks like, from one snapshot (fp4).

Reads $PM_DATA/snap_<stamp>/ (snap_universe.py) and writes results/m1_structure.json:
counts by fee category, the fee schedules the markets carry, tick and minimum
sizes, spreads and depth by category, the liquidity-reward pools and what a
small two-sided quote would earn in each against the book as it stood, and the
negative-risk sums (buy every YES / buy every NO) after taker fees.

usage: m1_structure.py <snap dir> <out json>
"""
import json
import math
import os
import statistics as st
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(__file__))
import pmnet  # noqa: E402


def fnum(x, d=None):
    try:
        return float(x)
    except (TypeError, ValueError):
        return d


def q(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    f, c = math.floor(k), math.ceil(k)
    return xs[f] if f == c else xs[f] + (xs[c] - xs[f]) * (k - f)


def levels(book, side):
    """[(price, size)] best first."""
    lv = [(fnum(o["price"]), fnum(o["size"])) for o in (book.get(side) or [])]
    lv = [x for x in lv if x[0] is not None and x[1] is not None and x[1] > 0]
    lv.sort(key=lambda x: -x[0] if side == "bids" else x[0])
    return lv


def adj_best(lv, min_size):
    """Best price among levels with at least min_size resting (the size-cutoff adjustment)."""
    for p, s in lv:
        if s >= min_size:
            return p
    return None


def score_side(lv, mid, v_cents, is_bid):
    """Sum of S(v,s)*size over levels within v cents of mid on one side."""
    tot = 0.0
    for p, s in lv:
        dist = (mid - p) if is_bid else (p - mid)
        dist_c = dist * 100.0
        if dist_c < -1e-9:
            continue
        if dist_c >= v_cents:
            break
        tot += ((v_cents - dist_c) / v_cents) ** 2 * s
    return tot


def cat_of(m):
    ft = m.get("feeType") or ""
    if ft.endswith("_fees"):
        return ft[:-5]
    if m.get("feesEnabled") is False or not ft:
        return "none"
    return ft


def main():
    snap, outp = sys.argv[1], sys.argv[2]
    markets = pmnet.load(os.path.join(snap, "markets.json"))
    books = pmnet.load(os.path.join(snap, "books.json"))
    rw_native = pmnet.load(os.path.join(snap, "rewards_native.json"))
    rw_spons = pmnet.load(os.path.join(snap, "rewards_sponsored.json"))
    meta = pmnet.load(os.path.join(snap, "meta.json"))
    out = {"snapshot": meta}

    live = [m for m in markets if m.get("enableOrderBook") and m.get("acceptingOrders") and not m.get("archived")]
    out["counts"] = {
        "open_markets": len(markets), "accepting_orders": len(live),
        "restricted_flag": sum(1 for m in live if m.get("restricted")),
        "neg_risk": sum(1 for m in live if m.get("negRisk")),
        "holding_rewards_enabled": sum(1 for m in live if m.get("holdingRewardsEnabled")),
        "fees_enabled": sum(1 for m in live if m.get("feesEnabled")),
        "rfq_enabled": sum(1 for m in live if m.get("rfqEnabled")),
    }
    by_cat = defaultdict(list)
    for m in live:
        by_cat[cat_of(m)].append(m)
    fee_sched = defaultdict(Counter)
    for m in live:
        fs = m.get("feeSchedule")
        key = json.dumps(fs, sort_keys=True) if fs else "null"
        fee_sched[cat_of(m)][key] += 1
    out["fee_schedules_by_category"] = {c: dict(v.most_common(4)) for c, v in fee_sched.items()}
    out["tick_sizes"] = dict(Counter(str(m.get("orderPriceMinTickSize")) for m in live).most_common())
    out["order_min_sizes"] = dict(Counter(str(m.get("orderMinSize")) for m in live).most_common())
    out["holding_rewards_by_category"] = {c: sum(1 for m in ms if m.get("holdingRewardsEnabled")) for c, ms in by_cat.items()}

    # spreads and depth by category, markets with >= $1k 24 h volume, YES token book
    cat_rows = defaultdict(list)
    mirror_checks = []
    for m in live:
        try:
            toks = json.loads(m.get("clobTokenIds") or "[]")
        except ValueError:
            continue
        if len(toks) != 2 or toks[0] not in books:
            continue
        b = books[toks[0]]
        bids, asks = levels(b, "bids"), levels(b, "asks")
        if not bids or not asks:
            continue
        bb, ba = bids[0][0], asks[0][0]
        mid = (bb + ba) / 2
        spread_c = (ba - bb) * 100
        dep1 = sum(p * s for p, s in bids if mid - p <= 0.01 + 1e-9) + sum(p * s for p, s in asks if p - mid <= 0.01 + 1e-9)
        dep3 = sum(p * s for p, s in bids if mid - p <= 0.03 + 1e-9) + sum(p * s for p, s in asks if p - mid <= 0.03 + 1e-9)
        row = {"vol24": m.get("volume24hr") or 0.0, "spread_c": spread_c, "mid": mid, "dep1": dep1, "dep3": dep3,
               "touch_usd": bids[0][0] * bids[0][1] + asks[0][0] * asks[0][1]}
        cat_rows[cat_of(m)].append(row)
        if toks[1] in books and len(mirror_checks) < 400:
            nb = books[toks[1]]
            nasks = levels(nb, "asks")
            nbids = levels(nb, "bids")
            if nasks and nbids:
                mirror_checks.append({"yes_best_bid": bb, "no_best_ask": nasks[0][0], "sum_bid_noask": round(bb + nasks[0][0], 6),
                                      "yes_best_ask": ba, "no_best_bid": nbids[0][0], "sum_ask_nobid": round(ba + nbids[0][0], 6),
                                      "same_size": abs(bids[0][1] - nasks[0][1]) < 1e-6})
    sd = {}
    for c, rows in cat_rows.items():
        act = [r for r in rows if r["vol24"] >= 1000]
        if not act:
            continue
        sd[c] = {"markets_vol24_ge_1k": len(act), "vol24_total": round(sum(r["vol24"] for r in act), 2),
                 "spread_c_p50": q([r["spread_c"] for r in act], 0.5), "spread_c_p90": q([r["spread_c"] for r in act], 0.9),
                 "depth_1c_usd_p50": q([r["dep1"] for r in act], 0.5), "depth_3c_usd_p50": q([r["dep3"] for r in act], 0.5),
                 "touch_usd_p50": q([r["touch_usd"] for r in act], 0.5),
                 "share_spread_1tick_or_less": round(sum(1 for r in act if r["spread_c"] <= 1.0001) / len(act), 3)}
    out["spreads_depth_by_category"] = sd
    out["book_mirror_checks"] = {
        "n": len(mirror_checks),
        "yes_bid_plus_no_ask_eq_1": sum(1 for x in mirror_checks if abs(x["sum_bid_noask"] - 1) < 1e-9),
        "yes_ask_plus_no_bid_eq_1": sum(1 for x in mirror_checks if abs(x["sum_ask_nobid"] - 1) < 1e-9),
        "same_size_at_touch": sum(1 for x in mirror_checks if x["same_size"]),
        "examples": mirror_checks[:5],
    }

    # liquidity rewards
    by_cond = {m["conditionId"]: m for m in live}
    pools = {}
    for r in rw_native:
        c = r["condition_id"]
        pools.setdefault(c, {"native": 0.0, "sponsored": 0.0, "max_spread": r.get("rewards_max_spread"),
                             "min_size": r.get("rewards_min_size")})
        pools[c]["native"] += fnum(r.get("native_daily_rate"), 0.0) or sum(fnum(x.get("rate_per_day"), 0.0) for x in r.get("rewards_config") or [])
        pools[c]["sponsored"] += fnum(r.get("sponsored_daily_rate"), 0.0) or 0.0
    for r in rw_spons:
        c = r["condition_id"]
        pools.setdefault(c, {"native": 0.0, "sponsored": 0.0, "max_spread": r.get("rewards_max_spread"),
                             "min_size": r.get("rewards_min_size")})
        if not pools[c]["sponsored"]:
            pools[c]["sponsored"] += fnum(r.get("sponsored_daily_rate"), 0.0) or fnum(r.get("total_daily_rate"), 0.0) or 0.0
    rates = [p["native"] + p["sponsored"] for p in pools.values()]
    out["rewards"] = {
        "markets_with_config": len(pools),
        "daily_total_usd": round(sum(rates), 2),
        "daily_native_usd": round(sum(p["native"] for p in pools.values()), 2),
        "daily_sponsored_usd": round(sum(p["sponsored"] for p in pools.values()), 2),
        "rate_p50": q(rates, 0.5), "rate_p90": q(rates, 0.9), "rate_max": max(rates) if rates else None,
        "min_size_dist": dict(Counter(str(p["min_size"]) for p in pools.values()).most_common(8)),
        "max_spread_dist": dict(Counter(str(p["max_spread"]) for p in pools.values()).most_common(8)),
        "rate_by_category": {},
    }
    rcat = defaultdict(float)
    for c, p in pools.items():
        m = by_cond.get(c)
        rcat[cat_of(m) if m else "not_open"] += p["native"] + p["sponsored"]
    out["rewards"]["rate_by_category"] = {k: round(v, 2) for k, v in sorted(rcat.items(), key=lambda x: -x[1])}

    # a small quote in every rewarded market: min size, two-sided, 1 cent inside the max spread
    rows = []
    for c, p in pools.items():
        m = by_cond.get(c)
        if not m:
            continue
        try:
            toks = json.loads(m.get("clobTokenIds") or "[]")
        except ValueError:
            continue
        if not toks or toks[0] not in books:
            continue
        b = books[toks[0]]
        bids, asks = levels(b, "bids"), levels(b, "asks")
        if not bids or not asks:
            continue
        v = fnum(p["max_spread"])
        ms = fnum(p["min_size"], 0.0) or 0.0
        if not v:
            continue
        ab, aa = adj_best(bids, ms), adj_best(asks, ms)
        if ab is None or aa is None:
            continue
        mid = (ab + aa) / 2
        q1 = score_side(bids, mid, v, True)
        q2 = score_side(asks, mid, v, False)
        two_sided_mid = 0.10 <= mid <= 0.90
        tick = fnum(m.get("orderPriceMinTickSize"), 0.01)
        # our order: the best price at or inside the touch that is a tick grid point, never crossing
        our_bid = min(bids[0][0] + tick, mid - tick / 2)
        our_bid = math.floor(our_bid / tick + 1e-9) * tick
        our_ask = max(asks[0][0] - tick, mid + tick / 2)
        our_ask = math.ceil(our_ask / tick - 1e-9) * tick
        s_b, s_a = (mid - our_bid) * 100, (our_ask - mid) * 100
        size = max(ms, 5.0 / max(our_bid, 0.01)) if ms else 5.0 / max(our_bid, 0.01)
        sc = lambda s: ((v - s) / v) ** 2 if s < v else 0.0
        our_q = min(sc(s_b) * size, sc(s_a) * size)
        others_central = min(q1, q2) if not two_sided_mid else max(min(q1, q2), max(q1, q2) / 3.0)
        others_high = q1 + q2
        rate = p["native"] + p["sponsored"]
        cap = size * our_bid + size * (1 - our_ask)
        share_c = our_q / (our_q + others_central) if our_q > 0 else 0.0
        share_lo = our_q / (our_q + others_high) if our_q > 0 else 0.0
        rows.append({"cond": c, "q": (m.get("question") or "")[:90], "cat": cat_of(m), "rate": rate, "v": v, "min_size": ms,
                     "mid": round(mid, 4), "spread_c": round((asks[0][0] - bids[0][0]) * 100, 3), "q_bid_side": round(q1, 1),
                     "q_ask_side": round(q2, 1), "our_size": round(size, 2), "our_q": round(our_q, 2), "capital": round(cap, 2),
                     "share_central": round(share_c, 5), "share_low": round(share_lo, 5),
                     "usd_day_central": round(share_c * rate, 4), "usd_day_low": round(share_lo * rate, 4),
                     "ret_day_central": round(share_c * rate / cap, 5) if cap > 0 else None,
                     "vol24": m.get("volume24hr") or 0.0, "end": m.get("endDate")})
    rows.sort(key=lambda r: -(r["ret_day_central"] or 0))
    out["reward_quote_rows_top40"] = rows[:40]
    out["reward_quote_summary"] = {
        "markets_priced": len(rows),
        "sum_usd_day_central_all_markets": round(sum(r["usd_day_central"] for r in rows), 2),
        "sum_capital_all_markets": round(sum(r["capital"] for r in rows), 2),
        "ret_day_central_p50": q([r["ret_day_central"] for r in rows if r["ret_day_central"] is not None], 0.5),
        "ret_day_central_p90": q([r["ret_day_central"] for r in rows if r["ret_day_central"] is not None], 0.9),
    }
    # best $100 and $300 of capital: greedy by central return, whole quotes only
    for budget in (100.0, 300.0):
        used, usd, n = 0.0, 0.0, 0
        for r in rows:
            if r["capital"] <= 0 or used + r["capital"] > budget:
                continue
            used += r["capital"]
            usd += r["usd_day_central"]
            n += 1
        out["reward_quote_summary"][f"greedy_{int(budget)}"] = {"quotes": n, "capital": round(used, 2), "usd_day_central": round(usd, 3),
                                                               "ret_year_central": round(usd / used * 365, 3) if used else None}

    # negative-risk sets: buy every YES at the ask / every NO at the ask (= 1 - YES bid), taker fees included
    ev = defaultdict(list)
    for m in live:
        if not m.get("negRisk"):
            continue
        e = (m.get("events") or [{}])[0]
        ev[e.get("id")].append(m)
    nr_rows = []
    for eid, ms in ev.items():
        yes_asks, yes_bids, fee_buy_yes, fee_buy_no, ok = [], [], 0.0, 0.0, True
        for m in ms:
            try:
                toks = json.loads(m.get("clobTokenIds") or "[]")
            except ValueError:
                ok = False
                break
            if not toks or toks[0] not in books:
                ok = False
                break
            b = books[toks[0]]
            bids, asks = levels(b, "bids"), levels(b, "asks")
            if not bids or not asks:
                ok = False
                break
            fs = m.get("feeSchedule") or {}
            r = fnum(fs.get("rate"), 0.0) if m.get("feesEnabled") else 0.0
            pa, pb = asks[0][0], bids[0][0]
            yes_asks.append((pa, asks[0][1]))
            yes_bids.append((pb, bids[0][1]))
            fee_buy_yes += r * pa * (1 - pa)
            fee_buy_no += r * (1 - pb) * pb
        if not ok or len(ms) < 2:
            continue
        s_ask = sum(p for p, _ in yes_asks)
        s_bid = sum(p for p, _ in yes_bids)
        n = len(ms)
        e0 = ms[0]["events"][0] if ms[0].get("events") else {}
        nr_rows.append({"event": eid, "title": (e0.get("title") or "")[:80], "n": n, "augmented": e0.get("negRiskAugmented"),
                        "sum_yes_ask": round(s_ask, 4), "buy_all_yes_edge": round(1 - s_ask - fee_buy_yes, 4),
                        "sum_yes_bid": round(s_bid, 4), "buy_all_no_edge": round(s_bid - 1 - fee_buy_no, 4),
                        "min_touch_size_yes": min(s for _, s in yes_asks), "min_touch_size_no": min(s for _, s in yes_bids),
                        "end": e0.get("endDate")})
    out["neg_risk"] = {
        "events_priced": len(nr_rows),
        "buy_all_yes_edge_gt0": [r for r in nr_rows if r["buy_all_yes_edge"] > 0],
        "buy_all_no_edge_gt0": [r for r in nr_rows if r["buy_all_no_edge"] > 0],
        "sum_yes_ask_p50": q([r["sum_yes_ask"] for r in nr_rows], 0.5),
        "sum_yes_bid_p50": q([r["sum_yes_bid"] for r in nr_rows], 0.5),
        "best_buy_all_yes": sorted(nr_rows, key=lambda r: -r["buy_all_yes_edge"])[:8],
        "best_buy_all_no": sorted(nr_rows, key=lambda r: -r["buy_all_no_edge"])[:8],
    }
    pmnet.dump(outp, out)
    print(json.dumps({k: out[k] for k in ("counts", "rewards", "reward_quote_summary")}, indent=1)[:4000])


if __name__ == "__main__":
    main()
