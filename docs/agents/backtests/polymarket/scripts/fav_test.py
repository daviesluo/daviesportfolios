"""FAV: the frozen test of `reviews/2026-09-24-polymarket-fp4-prereg-fav-favourites.md` (fp4).

Reads only the committed input (`inputs/fav_inputs.json.gz`, built by fav_inputs.py)
and writes one JSON: every arm, the calibration null and the bar, for the primary
horizon (24 h) and the two secondary ones (168 h, 1 h).

usage: fav_test.py <inputs .json.gz> <out json>
"""
import gzip
import json
import random
import sys
from collections import defaultdict
from datetime import datetime, timezone

LIMIT = 0.99
STAKE = 10.0
MIN_FILL = 2.0
HORIZONS = ["24", "168", "1"]
T_IS = datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp()
T_OOS1 = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()
T_OOS2 = datetime(2026, 6, 1, tzinfo=timezone.utc).timestamp()
T_END = datetime(2026, 9, 10, tzinfo=timezone.utc).timestamp()
OOS_DAYS = (T_END - T_OOS1) / 86400.0
NULL_DRAWS = 10000
SEED = 20260924


def r6(x):
    return None if x is None else round(x, 6)


def window(end):
    if T_IS <= end < T_OOS1:
        return "IS"
    if T_OOS1 <= end < T_OOS2:
        return "OOS1"
    if T_OOS2 <= end < T_END:
        return "OOS2"
    return None


def month(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m")


def candidates(markets, h, stake):
    counts = defaultdict(int)
    out = []
    for m in markets:
        if h not in m["tds"]:
            continue
        counts["open_at_Td"] += 1
        p0 = m["p0"].get(h)
        if p0 is None:
            counts["no_price_at_Td"] += 1
            continue
        if 0.90 <= p0 < 0.99:
            fav, pf = 0, p0
        elif 0.01 < p0 <= 0.10:
            fav, pf = 1, 1.0 - p0
        else:
            counts["no_favourite_in_band"] += 1
            continue
        pr = m["prints"].get(h)
        if pr is None:
            counts["prints_not_pulled"] += 1
            continue
        if pr == "incomplete":
            counts["print_walk_incomplete"] += 1
            continue
        tick = m["tick"] or 0.01
        remaining, fills = stake, []
        for ts, side, oi, price, size in pr:
            if oi == fav and side == "BUY":
                pfav = price
            elif oi is not None and oi != fav and side == "SELL":
                pfav = 1.0 - price
            else:
                continue
            if pfav > LIMIT + 1e-12:
                continue
            px = max(pfav, pf + tick)
            if px > LIMIT + 1e-12:
                continue
            q = min(size, remaining / px)
            if q <= 0:
                break
            fills.append((ts, px, q))
            remaining -= q * px
            if remaining <= 1e-9:
                break
        cost = stake - remaining
        if cost < MIN_FILL:
            counts["under_min_fill_in_hour"] += 1
            continue
        counts["filled"] += 1
        out.append({"cond": m["cond"], "event": m["event"] or m["cond"], "fav": fav, "pf": pf, "fills": fills,
                    "first": fills[0][0], "payout": m["payout"][fav], "end": m["end"], "closed": m["closed"],
                    "cat": m["cat"], "r": m["fee_rate"], "tick": tick, "q": m["q"]})
    # one trade per event: the earliest first fill, ties by condition id
    best = {}
    for c in sorted(out, key=lambda c: (c["first"], c["cond"])):
        best.setdefault(c["event"], c)
    counts["events_traded"] = len(best)
    return sorted(best.values(), key=lambda c: (c["first"], c["cond"])), dict(counts)


def pnl(c, tick_shift=0, fee_mult=1.0):
    tot = 0.0
    for _, px, q in c["fills"]:
        p = px + tick_shift * c["tick"]
        tot += q * (c["payout"] - p) - fee_mult * c["r"] * p * (1 - p) * q
    return tot


def cost_of(c):
    return sum(px * q for _, px, q in c["fills"])


def shares_of(c):
    return sum(q for _, _, q in c["fills"])


def fees_of(c):
    return sum(c["r"] * px * (1 - px) * q for _, px, q in c["fills"])


def peak_capital(trades):
    ev = []
    for c in trades:
        ev.append((c["first"], 1, cost_of(c)))
        ev.append((max(c["closed"], c["first"]), 0, -cost_of(c)))
    ev.sort()
    cur = peak = 0.0
    for _, _, d in ev:
        cur += d
        peak = max(peak, cur)
    return peak


def summarise(trades):
    if not trades:
        return {"trades": 0, "pnl": 0.0}
    p = [pnl(c) for c in trades]
    wins = sum(1 for c in trades if c["payout"] >= 1.0)
    part = sum(1 for c in trades if 0.0 < c["payout"] < 1.0)
    return {"trades": len(trades), "pnl": r6(sum(p)), "cost": r6(sum(cost_of(c) for c in trades)),
            "fees": r6(sum(fees_of(c) for c in trades)),
            "won": wins, "partial_payout": part, "lost": len(trades) - wins - part,
            "win_rate": r6(wins / len(trades)),
            "mean_fill_price": r6(sum(cost_of(c) for c in trades) / sum(shares_of(c) for c in trades)),
            "pnl_per_dollar": r6(sum(p) / sum(cost_of(c) for c in trades)),
            "mean_days_locked": r6(sum((max(c["closed"], c["first"]) - c["first"]) / 86400 for c in trades) / len(trades))}


def null_p95(trades):
    rng = random.Random(SEED)
    base = [(shares_of(c), cost_of(c), fees_of(c), cost_of(c) / shares_of(c)) for c in trades]
    draws = []
    for _ in range(NULL_DRAWS):
        tot = 0.0
        for sh, co, fe, q in base:
            tot += (sh if rng.random() < q else 0.0) - co - fe
        draws.append(tot)
    draws.sort()
    return {"mean": r6(sum(draws) / len(draws)), "p95": r6(draws[int(0.95 * len(draws))]), "draws": NULL_DRAWS}


def evaluate(trades, h):
    by_w = defaultdict(list)
    for c in trades:
        w = window(c["end"])
        if w:
            by_w[w].append(c)
    oos = by_w["OOS1"] + by_w["OOS2"]
    res = {w: summarise(by_w[w]) for w in ("IS", "OOS1", "OOS2")}
    res["OOS"] = summarise(oos)
    oos_pnl = sum(pnl(c) for c in oos)
    stress = sum(pnl(c, 1, 2.0) for c in oos)
    res["stress_OOS_pnl"] = r6(stress)
    res["stress_IS_pnl"] = r6(sum(pnl(c, 1, 2.0) for c in by_w["IS"]))
    nl = null_p95(oos) if oos else {"p95": None, "mean": None}
    res["null"] = nl
    months = defaultdict(float)
    for c in oos:
        months[month(c["first"])] += pnl(c)
    res["oos_by_month"] = {k: r6(v) for k, v in sorted(months.items())}
    best_m = max(months.values()) if months else 0.0
    peak = peak_capital(oos)
    ann = (oos_pnl * 365.0 / OOS_DAYS / peak) if peak > 0 else None
    res["oos_peak_capital"] = r6(peak)
    res["oos_return_per_year_on_peak"] = r6(ann)
    bar = {
        "1_oos_pos_and_both_halves": oos_pnl > 0 and sum(pnl(c) for c in by_w["OOS1"]) > 0 and sum(pnl(c) for c in by_w["OOS2"]) > 0,
        "2_beats_null_p95": nl["p95"] is not None and oos_pnl > nl["p95"],
        "3_stress_pos": stress > 0,
        "4_at_least_200_trades": len(oos) >= 200,
        "5_not_one_month": oos_pnl > 0 and best_m <= 0.40 * oos_pnl and (oos_pnl - best_m) > 0,
        "6_beats_cash": ann is not None and ann > 0.04,
    }
    res["bar"] = bar
    res["passes"] = all(bar.values())
    # descriptive
    cats = defaultdict(list)
    for c in oos:
        cats[c["cat"]].append(c)
    res["oos_by_category"] = {k: summarise(v) for k, v in sorted(cats.items())}
    bands = {"0.90-0.95": [c for c in oos if c["pf"] < 0.95], "0.95-0.99": [c for c in oos if c["pf"] >= 0.95]}
    res["oos_by_band"] = {k: summarise(v) for k, v in bands.items()}
    worst = sorted(oos + by_w["IS"], key=lambda c: pnl(c))[:12]
    res["largest_losses"] = [{"q": c["q"], "window": window(c["end"]), "pf": r6(c["pf"]), "payout": c["payout"],
                              "pnl": r6(pnl(c)), "cat": c["cat"], "cond": c["cond"]} for c in worst]
    # a fixed sample of OOS trades with their fills, for re-deriving by hand from the raw prints
    rng = random.Random(SEED + 1)
    pick = rng.sample(oos, min(20, len(oos))) if oos else []
    res["sample_trades"] = [{"cond": c["cond"], "fav": c["fav"], "pf": r6(c["pf"]), "payout": c["payout"], "r": c["r"], "tick": c["tick"],
                             "fills": [[t, r6(px), r6(q)] for t, px, q in c["fills"]], "pnl": r6(pnl(c))} for c in pick]
    return res


def calibration(markets):
    out = {}
    for h in HORIZONS:
        bins = defaultdict(lambda: {"IS": [0, 0.0, 0.0], "OOS": [0, 0.0, 0.0]})
        for m in markets:
            if h not in m["tds"] or m["p0"].get(h) is None:
                continue
            w = window(m["end"])
            if not w:
                continue
            w = "IS" if w == "IS" else "OOS"
            p0 = m["p0"][h]
            b = min(19, int(p0 * 20))
            x = bins[b][w]
            x[0] += 1
            x[1] += p0
            x[2] += m["payout"][0]
        out[h] = {f"{b / 20:.2f}-{(b + 1) / 20:.2f}": {w: {"n": v[0], "mean_price": r6(v[1] / v[0]) if v[0] else None,
                                                            "mean_payout": r6(v[2] / v[0]) if v[0] else None}
                                                        for w, v in d.items()} for b, d in sorted(bins.items())}
    return out


def main():
    inp, outp = sys.argv[1], sys.argv[2]
    with gzip.open(inp, "rb") as f:
        blob = json.loads(f.read())
    markets = blob["markets"]
    out = {"prereg": "reviews/2026-09-24-polymarket-fp4-prereg-fav-favourites.md", "input_markets": len(markets),
           "oos_days": r6(OOS_DAYS), "horizons": {}}
    for h in HORIZONS:
        trades, counts = candidates(markets, h, STAKE)
        res = evaluate(trades, h)
        res["counts"] = counts
        cap, _ = candidates(markets, h, 100.0)
        capw = [c for c in cap if window(c["end"]) in ("OOS1", "OOS2")]
        res["capacity_100"] = {"OOS": summarise(capw), "mean_cost_filled": r6(sum(cost_of(c) for c in capw) / len(capw)) if capw else None}
        out["horizons"][h] = res
    out["primary"] = {"horizon": "24", "passes": out["horizons"]["24"]["passes"], "bar": out["horizons"]["24"]["bar"]}
    out["calibration_all_tokens"] = calibration(markets)
    with open(outp, "w") as f:
        json.dump(out, f, sort_keys=True, indent=1)
    p = out["horizons"]["24"]
    print(json.dumps({"primary_passes": p["passes"], "bar": p["bar"], "IS": p["IS"], "OOS": p["OOS"],
                      "null": p["null"], "stress": p["stress_OOS_pnl"], "ret": p["oos_return_per_year_on_peak"]}, indent=1))


if __name__ == "__main__":
    main()
