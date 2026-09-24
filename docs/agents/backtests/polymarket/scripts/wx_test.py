"""WX: the frozen test of `reviews/2026-09-24-polymarket-fp4-prereg-wx-weather.md` (fp4).

Reads only the committed input (`inputs/wx_inputs.json.gz`) and writes one JSON:
the fitted error model, the primary rule's trades by window, the stress arm, the
calibration null, the bar, and the descriptive arms.

usage: wx_test.py <inputs .json.gz> <out json>
"""
import gzip
import json
import math
import random
import sys
from collections import defaultdict
from datetime import datetime, timezone

STAKE = 5.0
MIN_FILL = 1.0
FEE = 0.05
EDGE = 0.10
SEED = 20260924
NULL_DRAWS = 10000
T_OOS1, T_OOS2, T_END = "2026-03-01", "2026-06-01", "2026-09-10"
OOS_DAYS = (datetime(2026, 9, 10) - datetime(2026, 3, 1)).days
MU = [round(-5 + 0.1 * i, 1) for i in range(101)]
SIG = [round(0.5 + 0.05 * i, 2) for i in range(151)]


def r6(x):
    return None if x is None else round(x, 6)


def phi(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def window(d):
    if d < T_OOS1:
        return "IS"
    if d < T_OOS2:
        return "OOS1"
    if d < T_END:
        return "OOS2"
    return None


def forecast(e):
    key = "max2" if e["hl"] == "highest" else "min2"
    c = (e.get("f") or {}).get(key)
    if c is None:
        return None
    return c * 9.0 / 5.0 + 32.0 if e["unit"] == "F" else c


def bucket_prob(iv, f, mu, sig):
    lo = 0.0 if iv[0] is None else phi((iv[0] - f - mu) / sig)
    hi = 1.0 if iv[1] is None else phi((iv[1] - f - mu) / sig)
    return max(0.0, hi - lo)


def fit(rows):
    """rows: [(lo - f, hi - f)] of the winning buckets; grid maximum likelihood, first maximum in grid order."""
    best = None
    for s in SIG:
        for m in MU:
            ll = 0.0
            for a, b in rows:
                p = (1.0 if b is None else phi((b - m) / s)) - (0.0 if a is None else phi((a - m) / s))
                ll += math.log(max(p, 1e-12))
            if best is None or ll > best[0] + 1e-12:
                best = (ll, m, s)
    return {"mu": best[1], "sigma": best[2], "loglik": r6(best[0]), "n": len(rows)}


def fit_models(events):
    groups = defaultdict(list)
    for e in events:
        if window(e["date"]) != "IS":
            continue
        f = forecast(e)
        wins = [m for m in e["markets"] if m["payout_yes"] >= 1.0]
        if f is None or len(wins) != 1:
            continue
        iv = wins[0]["iv"]
        rel = (None if iv[0] is None else iv[0] - f, None if iv[1] is None else iv[1] - f)
        groups[("city", e["city"], e["hl"])].append(rel)
        groups[("unit_hl", e["unit"], e["hl"])].append(rel)
        groups[("unit", e["unit"])].append(rel)
    fits = {}
    for k, rows in groups.items():
        # a city's own fit needs 40 IS events; the pooled fits are used whenever they have any
        if k[0] != "city" or len(rows) >= 40:
            fits[k] = fit(rows)
    return fits


def model_for(fits, e):
    for k in (("city", e["city"], e["hl"]), ("unit_hl", e["unit"], e["hl"]), ("unit", e["unit"])):
        if k in fits:
            return fits[k], k
    return None, None


def decide(events, fits, edge, stake):
    counts = defaultdict(int)
    trades = []
    brier = {"model": [0, 0.0], "market": [0, 0.0]}
    for e in events:
        w = window(e["date"])
        if not w:
            continue
        f = forecast(e)
        mdl, key = model_for(fits, e)
        if f is None or mdl is None:
            counts["no_forecast_or_model"] += 1
            continue
        td = e["td"]
        cands = []
        for m in e["markets"]:
            if m["p"] is None or not (m["start"] and m["closed"] and m["start"] < td < m["closed"]):
                continue
            pi = bucket_prob(m["iv"], f, mdl["mu"], mdl["sigma"])
            if w != "IS":
                y = m["payout_yes"]
                brier["model"][0] += 1
                brier["model"][1] += (pi - y) ** 2
                brier["market"][0] += 1
                brier["market"][1] += (m["p"] - y) ** 2
            if 0.02 <= m["p"] <= 0.98:
                cands.append((-abs(pi - m["p"]), m["cond"], m, pi))
        if not cands:
            counts["no_priced_bucket"] += 1
            continue
        cands.sort(key=lambda x: (x[0], x[1]))
        _, _, m, pi = cands[0]
        e_ = pi - m["p"]
        if abs(e_) < edge:
            counts["edge_below_threshold"] += 1
            continue
        if not e["prints_pulled"] or not e["prints_complete"]:
            counts["prints_incomplete"] += 1
            continue
        fav = 0 if e_ > 0 else 1
        shown = m["p"] if fav == 0 else 1.0 - m["p"]
        mv = pi if fav == 0 else 1.0 - pi
        limit = min(mv - 0.05, 0.99)
        tick = m["tick"] or 0.01
        remaining, fills = stake, []
        for ts, side, oi, price, size in m["prints"]:
            if oi == fav and side == "BUY":
                pe = price
            elif oi is not None and oi != fav and side == "SELL":
                pe = 1.0 - price
            else:
                continue
            px = max(pe, shown + tick)
            if px > limit + 1e-12:
                continue
            q = min(size, remaining / px)
            if q <= 0:
                break
            fills.append((ts, px, q))
            remaining -= q * px
            if remaining <= 1e-9:
                break
        if stake - remaining < MIN_FILL:
            counts["under_min_fill_in_hour"] += 1
            continue
        counts["traded"] += 1
        payout = m["payout_yes"] if fav == 0 else 1.0 - m["payout_yes"]
        trades.append({"event": e["event"], "cond": m["cond"], "city": e["city"], "date": e["date"], "hl": e["hl"], "window": w, "side": "YES" if fav == 0 else "NO",
                       "edge": e_, "pi": pi, "p": m["p"], "fills": fills, "first": fills[0][0], "closed": m["closed"], "tick": tick,
                       "payout": payout, "model": list(key)})
    return trades, dict(counts), brier


def pnl(t, tick_shift=0, fee_mult=1.0):
    tot = 0.0
    for _, px, q in t["fills"]:
        p = px + tick_shift * t["tick"]
        tot += q * (t["payout"] - p) - fee_mult * FEE * p * (1 - p) * q
    return tot


def cost(t):
    return sum(px * q for _, px, q in t["fills"])


def shares(t):
    return sum(q for _, _, q in t["fills"])


def fees(t):
    return sum(FEE * px * (1 - px) * q for _, px, q in t["fills"])


def summ(ts):
    if not ts:
        return {"trades": 0, "pnl": 0.0}
    c = sum(cost(t) for t in ts)
    return {"trades": len(ts), "pnl": r6(sum(pnl(t) for t in ts)), "cost": r6(c), "fees": r6(sum(fees(t) for t in ts)),
            "won": sum(1 for t in ts if t["payout"] >= 1), "lost": sum(1 for t in ts if t["payout"] <= 0),
            "mean_fill_price": r6(c / sum(shares(t) for t in ts)), "pnl_per_dollar": r6(sum(pnl(t) for t in ts) / c)}


def evaluate(trades):
    by = defaultdict(list)
    for t in trades:
        by[t["window"]].append(t)
    oos = by["OOS1"] + by["OOS2"]
    res = {w: summ(by[w]) for w in ("IS", "OOS1", "OOS2")}
    res["OOS"] = summ(oos)
    oos_pnl = sum(pnl(t) for t in oos)
    stress = sum(pnl(t, 1, 2.0) for t in oos)
    res["stress_OOS_pnl"] = r6(stress)
    rng = random.Random(SEED)
    base = [(shares(t), cost(t), fees(t), cost(t) / shares(t)) for t in oos]
    draws = []
    for _ in range(NULL_DRAWS if base else 0):
        draws.append(sum((sh if rng.random() < q else 0.0) - co - fe for sh, co, fe, q in base))
    draws.sort()
    p95 = draws[int(0.95 * len(draws))] if draws else None
    res["null"] = {"mean": r6(sum(draws) / len(draws)) if draws else None, "p95": r6(p95)}
    months = defaultdict(float)
    for t in oos:
        months[datetime.fromtimestamp(t["first"], timezone.utc).strftime("%Y-%m")] += pnl(t)
    res["oos_by_month"] = {k: r6(v) for k, v in sorted(months.items())}
    best_m = max(months.values()) if months else 0.0
    ev = []
    for t in oos:
        ev.append((t["first"], cost(t)))
        ev.append((max(t["closed"], t["first"]), -cost(t)))
    ev.sort()
    cur = peak = 0.0
    for _, d in ev:
        cur += d
        peak = max(peak, cur)
    ann = oos_pnl * 365.0 / OOS_DAYS / peak if peak > 0 else None
    res["oos_peak_capital"] = r6(peak)
    res["oos_return_per_year_on_peak"] = r6(ann)
    res["bar"] = {"1_oos_pos_and_both_halves": oos_pnl > 0 and sum(pnl(t) for t in by["OOS1"]) > 0 and sum(pnl(t) for t in by["OOS2"]) > 0,
                  "2_beats_null_p95": p95 is not None and oos_pnl > p95, "3_stress_pos": stress > 0,
                  "4_at_least_200_trades": len(oos) >= 200,
                  "5_not_one_month": oos_pnl > 0 and best_m <= 0.4 * oos_pnl and oos_pnl - best_m > 0,
                  "6_beats_cash": ann is not None and ann > 0.04}
    res["passes"] = all(res["bar"].values())
    sides = defaultdict(list)
    cities = defaultdict(list)
    for t in oos:
        sides[t["side"]].append(t)
        cities[t["city"]].append(t)
    res["oos_by_side"] = {k: summ(v) for k, v in sorted(sides.items())}
    res["oos_by_city"] = {k: summ(v) for k, v in sorted(cities.items())}
    return res


def main():
    inp, outp = sys.argv[1], sys.argv[2]
    with gzip.open(inp, "rb") as f:
        events = json.loads(f.read())["events"]
    fits = fit_models(events)
    out = {"prereg": "reviews/2026-09-24-polymarket-fp4-prereg-wx-weather.md", "events": len(events),
           "fits": {"|".join(k): v for k, v in sorted(fits.items(), key=lambda x: "|".join(x[0]))}}
    trades, counts, brier = decide(events, fits, EDGE, STAKE)
    res = evaluate(trades)
    res["counts"] = counts
    res["brier_oos_buckets"] = {k: {"n": v[0], "brier": r6(v[1] / v[0]) if v[0] else None} for k, v in brier.items()}
    out["primary"] = res
    for thr in (0.05, 0.20):
        tr, _, _ = decide(events, fits, thr, STAKE)
        r = evaluate(tr)
        out[f"edge_{thr}"] = {k: r[k] for k in ("IS", "OOS1", "OOS2", "OOS", "stress_OOS_pnl", "null", "bar", "passes")}
    out["largest_losses"] = [{k: (r6(v) if isinstance(v, float) else v) for k, v in t.items() if k != "fills"}
                             for t in sorted((t for t in trades if t["window"] != "IS"), key=pnl)[:10]]
    # a fixed sample of OOS trades with their fills, for re-deriving by hand from the raw prints
    oos_t = [t for t in trades if t["window"] != "IS"]
    pick = random.Random(SEED + 1).sample(oos_t, min(20, len(oos_t))) if oos_t else []
    out["sample_trades"] = [{"event": t["event"], "cond": t["cond"], "city": t["city"], "date": t["date"], "side": t["side"], "p": r6(t["p"]), "pi": r6(t["pi"]),
                             "payout": t["payout"], "tick": t["tick"], "fills": [[a, r6(b), r6(c)] for a, b, c in t["fills"]], "pnl": r6(pnl(t))}
                            for t in pick]
    with open(outp, "w") as f:
        json.dump(out, f, sort_keys=True, indent=1)
    print(json.dumps({"passes": res["passes"], "bar": res["bar"], "IS": res["IS"], "OOS": res["OOS"], "null": res["null"],
                      "stress": res["stress_OOS_pnl"], "ret": res["oos_return_per_year_on_peak"], "brier": res["brier_oos_buckets"],
                      "counts": counts}, indent=1))


if __name__ == "__main__":
    main()
