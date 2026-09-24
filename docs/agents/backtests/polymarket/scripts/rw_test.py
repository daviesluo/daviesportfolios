"""RW: the frozen test of `reviews/2026-09-24-polymarket-fp4-prereg-rw-reward-quotes.md` (fp4).

Reads only the committed input (`inputs/rw_inputs.json.gz`, built by rw_inputs.py)
and writes one JSON: the primary portfolio, the stress arm, the market bootstrap,
the bar, and the descriptive arms (every market alone, by category, twice the
size, fills and markouts).

usage: rw_test.py <inputs .json.gz> <out json>
"""
import gzip
import json
import math
import random
import sys
from collections import defaultdict

BUDGET = 300.0
SEED = 20260924
BOOT = 2000


def r6(x):
    return None if x is None else round(x, 6)


def floor_tick(x, t):
    return math.floor(x / t + 1e-9) * t


def ceil_tick(x, t):
    return math.ceil(x / t - 1e-9) * t


def S(v, s):
    return ((v - s) / v) ** 2 if 0 <= s < v else 0.0


def quote(row, tick):
    bb, ba, ab, aa, q1, q2 = row
    if ab is None or aa is None:
        return None
    m = (ab + aa) / 2
    b = floor_tick(min(bb + tick, m - tick / 2), tick)
    a = ceil_tick(max(ba - tick, m + tick / 2), tick)
    if b >= ba - 1e-12:
        b = floor_tick(ba - tick, tick)
    if a <= bb + 1e-12:
        a = ceil_tick(bb + tick, tick)
    if b <= 0 or a >= 1 or b >= a - 1e-12:
        return None
    return m, b, a, q1, q2


def others_of(m, q1, q2):
    return max(min(q1, q2), (q1 + q2) / 3.0) if 0.10 <= m <= 0.90 else min(q1, q2)


def first_score(mk, n_mult=1.0):
    """Expected reward per dollar at the first round, and that round's capital."""
    tick = mk["tick"] or 0.01
    N = max(mk["min_size"], 5.0) * n_mult
    for minute, row in mk["series"][:1]:
        if row is None:
            return None
        q = quote(row, tick)
        if q is None:
            return None
        m, b, a, q1, q2 = q
        ours = min(S(mk["v"], (m - b) * 100) * N, S(mk["v"], (a - m) * 100) * N)
        cap = N * (b + 1 - a)
        if ours <= 0 or cap <= 0:
            return None
        return mk["rate"] / 1440 * ours / (ours + others_of(m, q1, q2)) / cap, cap
    return None


def run_market(mk, window_end, n_mult=1.0, reward_mult=1.0, tick_worse=0):
    v, rate = mk["v"], mk["rate"]
    tick = mk["tick"] or 0.01
    N = max(mk["min_size"], 5.0) * n_mult
    prints = mk["prints"]
    series = mk["series"]
    mids = {minute: None for minute, _ in series}
    pi = 0
    net = cash = reward = 0.0
    fills = []
    first_cap = None
    max_inv_cost = 0.0
    last_m = None
    quoted_minutes = 0
    for minute, row in series:
        q = quote(row, tick) if row else None
        if q is None:
            continue
        m, b, a, q1, q2 = q
        mids[minute] = m
        last_m = m
        quoted_minutes += 1
        if first_cap is None:
            first_cap = N * (b + 1 - a)
        qb, qa = net < 3 * N, net > -3 * N
        ours = min(S(v, (m - b) * 100) * N if qb else 0.0, S(v, (a - m) * 100) * N if qa else 0.0)
        if ours > 0:
            reward += rate / 1440.0 * ours / (ours + others_of(m, q1, q2))
        while pi < len(prints) and prints[pi][0] <= minute:
            pi += 1
        bid_left, ask_left = (N if qb else 0.0), (N if qa else 0.0)
        j = pi
        while j < len(prints) and prints[j][0] <= minute + 60:
            ts, side, oi, price, size = prints[j]
            j += 1
            if oi == 0:
                ypx, dirn = price, side
            elif oi == 1:
                ypx, dirn = 1.0 - price, ("SELL" if side == "BUY" else "BUY")
            else:
                continue
            if dirn == "SELL" and bid_left > 0 and ypx < b - 1e-12:
                qf = min(bid_left, size)
                bid_left -= qf
                px = b + tick_worse * tick
                net += qf
                cash -= qf * px
                fills.append((ts, "bid", px, qf, minute))
                max_inv_cost = max(max_inv_cost, net * px)
            elif dirn == "BUY" and ask_left > 0 and ypx > a + 1e-12:
                qf = min(ask_left, size)
                ask_left -= qf
                px = a - tick_worse * tick
                net -= qf
                cash += qf * px
                fills.append((ts, "ask", px, qf, minute))
                max_inv_cost = max(max_inv_cost, -net * (1 - px))
        pi = j
    st = mk.get("status") or {}
    mark, resolved = last_m, False
    try:
        op = [float(x) for x in json.loads(st.get("outcomePrices") or "[]")]
    except (ValueError, TypeError):
        op = []
    ct = st.get("closedTime")
    if st.get("closed") and op and ct:
        from datetime import datetime
        s = ct.strip().replace(" ", "T")
        if s.endswith("+00"):
            s += ":00"
        try:
            cts = datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
        except ValueError:
            cts = None
        if cts is not None and cts <= window_end:
            mark, resolved = op[0], True
    fill_pnl = cash + net * (mark if mark is not None else 0.0)
    # markouts (positive = in our favour), from the adjusted mid 5 and 60 minutes after the fill minute
    mk_min = sorted(k for k, x in mids.items() if x is not None)
    mo5, mo60 = [], []
    for ts, sd, px, qf, minute in fills:
        for lag, acc in ((300, mo5), (3600, mo60)):
            later = next((mids[k] for k in mk_min if k >= minute + lag), None)
            if later is None:
                later = mark
            if later is None:
                continue
            acc.append(((later - px) if sd == "bid" else (px - later)) * qf)
    return {"reward": reward * reward_mult, "fill_pnl": fill_pnl, "total": reward * reward_mult + fill_pnl,
            "fills": len(fills), "fill_shares": sum(f[3] for f in fills), "net_end": net, "resolved": resolved,
            "capital": (first_cap or 0.0) + max_inv_cost, "first_cap": first_cap or 0.0, "quoted_minutes": quoted_minutes,
            "markout5_usd": sum(mo5), "markout60_usd": sum(mo60)}


def portfolio(markets, conds, window_end, **kw):
    rows = {c: run_market(markets[c], window_end, **kw) for c in conds}
    tot = sum(r["total"] for r in rows.values())
    return rows, {"markets": len(rows), "total": r6(tot), "reward": r6(sum(r["reward"] for r in rows.values())),
                  "fill_pnl": r6(sum(r["fill_pnl"] for r in rows.values())), "fills": sum(r["fills"] for r in rows.values()),
                  "capital": r6(sum(r["capital"] for r in rows.values())),
                  "markout5_usd": r6(sum(r["markout5_usd"] for r in rows.values())),
                  "markout60_usd": r6(sum(r["markout60_usd"] for r in rows.values())),
                  "resolved_in_window": sum(1 for r in rows.values() if r["resolved"])}


def main():
    inp, outp = sys.argv[1], sys.argv[2]
    with gzip.open(inp, "rb") as f:
        blob = json.loads(f.read())
    markets = blob["markets"]
    window_end = blob["first_minute"] + blob["window_s"]
    hours = blob["window_s"] / 3600.0
    scored = []
    for c, mk in markets.items():
        fs = first_score(mk)
        if fs:
            scored.append((-fs[0], c, fs[1], fs[0]))
    scored.sort()
    chosen, used = [], 0.0
    for _, c, cap, _ in scored:
        if used + cap <= BUDGET + 1e-9:
            chosen.append(c)
            used += cap
    rows, prim = portfolio(markets, chosen, window_end)
    _, stress = portfolio(markets, chosen, window_end, reward_mult=0.5, tick_worse=1)
    _, twice = portfolio(markets, chosen, window_end, n_mult=2.0)
    totals = [rows[c]["total"] for c in chosen]
    rng = random.Random(SEED)
    boots = sorted(sum(rng.choice(totals) for _ in totals) for _ in range(BOOT)) if totals else [0.0]
    best = max(totals) if totals else 0.0
    tot = prim["total"] or 0.0
    cap = prim["capital"] or 0.0
    ann = tot / cap * (365 * 24 / hours) if cap > 0 else None
    bar = {"1_total_pos": tot > 0, "2_stress_pos": (stress["total"] or 0) > 0, "3_at_least_30_fills": prim["fills"] >= 30,
           "4_not_one_market": tot > 0 and best <= 0.5 * tot and (tot - best) > 0,
           "5_bootstrap_p05_pos": boots[int(0.05 * len(boots))] > 0, "6_beats_cash": ann is not None and ann > 0.04}
    all_rows, all_sum = portfolio(markets, sorted(markets), window_end)
    cats = defaultdict(list)
    for c, r in all_rows.items():
        cats[markets[c].get("cat") or "none"].append(r)
    by_cat = {k: {"markets": len(v), "total": r6(sum(x["total"] for x in v)), "reward": r6(sum(x["reward"] for x in v)),
                  "fill_pnl": r6(sum(x["fill_pnl"] for x in v)), "fills": sum(x["fills"] for x in v),
                  "capital": r6(sum(x["capital"] for x in v))} for k, v in sorted(cats.items())}
    out = {"prereg": "reviews/2026-09-24-polymarket-fp4-prereg-rw-reward-quotes.md", "T0": blob["T0"],
           "first_minute": blob["first_minute"], "hours": hours, "rounds": blob["rounds"], "universe": len(markets),
           "prints_incomplete": len(blob["prints_incomplete"]),
           "primary": dict(prim, return_per_year_on_capital=r6(ann), bootstrap_p05=r6(boots[int(0.05 * len(boots))]),
                           bootstrap_p50=r6(boots[len(boots) // 2]), best_market_total=r6(best)),
           "stress": stress, "twice_size": twice, "bar": bar, "passes": all(bar.values()),
           "primary_markets": [{"cond": c, "q": markets[c].get("q"), "cat": markets[c].get("cat"), "rate": markets[c]["rate"],
                                "ex_ante_per_dollar_day": r6(next(x[3] for x in scored if x[1] == c) * 1440),
                                **{k: r6(v) if isinstance(v, float) else v for k, v in rows[c].items()}} for c in chosen],
           "all_markets": all_sum, "all_by_category": by_cat,
           "all_top10_total": sorted(({"cond": c, "q": markets[c].get("q"), **{k: r6(v) if isinstance(v, float) else v for k, v in r.items()}}
                                     for c, r in all_rows.items()), key=lambda x: -(x["total"] or 0))[:10],
           "all_bottom10_total": sorted(({"cond": c, "q": markets[c].get("q"), **{k: r6(v) if isinstance(v, float) else v for k, v in r.items()}}
                                        for c, r in all_rows.items()), key=lambda x: (x["total"] or 0))[:10]}
    with open(outp, "w") as f:
        json.dump(out, f, sort_keys=True, indent=1)
    print(json.dumps({"passes": out["passes"], "bar": bar, "primary": out["primary"], "stress": stress, "all": all_sum}, indent=1))


if __name__ == "__main__":
    main()
