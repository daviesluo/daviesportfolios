"""Test CB (prereg_cascade_bids.md, frozen 2026-09-23T15:54:23Z): deep resting bids for liquidation
cascades on Binance spot, top-10 point-in-time universe, the Price Range Execution Rule applied
retroactively.

usage: python3 analysis/cb_test.py OUT.json
Reads data/universe_top10.json, data/cb_screen.json, data/bn_1m_cb/<SYM>.json (1-minute klines of the
screened days +-1), data/bn_1h/<SYM>.json (hourly klines, for the null), data/binance_executionRules_all.json,
data/cb_spreads.json. Deterministic."""
import json, os, sys, random, datetime

S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(S, "results", "cb_run.json")
MIN, HOUR = 60000, 3600000
RUNGS = [0.05, 0.10, 0.15]
SIZE = 100.0
FEE = 0.0010
SEED = 20260923
NULL_DRAWS = 1000
CAPITAL = 10 * 3 * 100.0
WIN = [("IS", "2020-01-01", "2023-01-01"), ("OOS1", "2023-01-01", "2025-01-01"), ("OOS2", "2025-01-01", "2026-09-22")]
POST_ROLLOUT = "2026-04-01"


def ms(d):
    return int(datetime.datetime.fromisoformat(d).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


def day_of(t):
    return datetime.datetime.utcfromtimestamp(t / 1000).strftime("%Y-%m-%d")


def win_of(t):
    for w, a, b in WIN:
        if ms(a) <= t < ms(b):
            return w
    return None


U = json.load(open(os.path.join(S, "data", "universe_top10.json")))
RULES = {r["symbol"]: 1 - float(r["rules"][0]["bidLimitMultDown"]) for r in json.load(open(os.path.join(S, "data", "binance_executionRules_all.json")))["symbolRules"]}
HS = json.load(open(os.path.join(S, "data", "cb_spreads.json")))["half_spread_bps"]
SCREEN = json.load(open(os.path.join(S, "data", "cb_screen.json")))
days_in = {}
for d, syms in U.items():
    if "2020-01-01" <= d <= "2026-09-21":
        for s in syms:
            days_in.setdefault(s, set()).add(d)


def run_symbol(sym, arm):
    """arm: fee, hmult, cap (bool), close_twin (bool). Returns trips."""
    fn = os.path.join(S, "data", "bn_1m_cb", f"{sym}.json")
    if sym not in SCREEN or not os.path.exists(fn):
        return []
    rows = json.load(open(fn))
    idx = {r[0]: i for i, r in enumerate(rows)}
    R = RULES.get(sym, 0.25)
    h = HS.get(sym, 5.0) / 1e4
    fee = arm["fee"]
    hcost = h * arm["hmult"]
    screened = set(SCREEN[sym])
    trips = []
    busy_until = {k: -1 for k in RUNGS}  # time (ms) until which the rung holds a position
    n = len(rows)
    for i in range(5, n):
        t, o, hi, lo, c, v = rows[i]
        d = day_of(t)
        if d not in screened:
            continue
        # the five previous minutes must be the contiguous previous minutes
        if rows[i - 5][0] != t - 5 * MIN:
            continue
        c2 = rows[i - 2][4]
        ref5 = sum(rows[j][4] for j in range(i - 5, i)) / 5.0
        for k in RUNGS:
            if busy_until[k] >= t:
                continue
            bid = c2 * (1 - k)
            if not lo < bid:
                continue
            if arm["cap"] and not bid > ref5 * (1 - R):
                continue
            entry = c if arm["close_twin"] else bid
            qty = SIZE / entry
            target = entry * (1 + k / 2)
            # exit: from minute i+1, first minute with high > target, within 1,440 minutes; else time stop
            exit_px, exit_t, kind = None, None, None
            j = i + 1
            stop_t = t + 1440 * MIN
            while j < n and rows[j][0] < stop_t:
                if rows[j][0] != rows[j - 1][0] + MIN:
                    break  # the data has a hole (the day after is missing): treat as data end
                if rows[j][2] > target:
                    exit_px, exit_t, kind = target, rows[j][0], "target"
                    break
                j += 1
            if exit_px is None:
                if j < n and rows[j][0] == stop_t and rows[j][0] == rows[j - 1][0] + MIN:
                    exit_px, exit_t, kind = rows[j][4] * (1 - hcost), rows[j][0], "stop"
                else:
                    jj = min(j, n) - 1
                    exit_px, exit_t, kind = rows[jj][4] * (1 - hcost), rows[jj][0], "data_end"
            fees = fee * SIZE + fee * exit_px * qty
            pnl = (exit_px - entry) * qty - fees
            busy_until[k] = exit_t
            trips.append({"sym": sym, "t": t, "k": k, "entry": round(entry, 10), "exit": round(exit_px, 10), "exit_t": exit_t, "kind": kind,
                          "pnl": round(pnl, 6), "win": win_of(t), "drop_to_low": round(lo / c2 - 1, 5), "close_vs_bid": round(c / bid - 1, 5)})
    return trips


def hourly(sym):
    fn = os.path.join(S, "data", "bn_1h", f"{sym}.json")
    return json.load(open(fn)) if os.path.exists(fn) else []


def null_units(sym, k, w, fee, hcost):
    """Per-$100 outcome of a random-time entry at the open of each candidate hour (coin in the universe that day, hour in w)."""
    rows = hourly(sym)
    a, b = [(ms(x[1]), ms(x[2])) for x in WIN if x[0] == w][0]
    out = []
    idx = {r[0]: i for i, r in enumerate(rows)}
    dset = days_in.get(sym, set())
    for i, r in enumerate(rows):
        t = r[0]
        if not (a <= t < b) or day_of(t) not in dset:
            continue
        entry = r[1]
        if entry <= 0:
            continue
        target = entry * (1 + k / 2)
        qty = SIZE / entry
        px = None
        for j in range(i + 1, min(i + 24, len(rows))):
            if rows[j][0] != rows[j - 1][0] + HOUR:
                break
            if rows[j][2] > target:
                px = target
                break
        if px is None:
            jj = min(i + 23, len(rows) - 1)
            px = rows[jj][4] * (1 - hcost)
        out.append((px - entry) * qty - fee * SIZE - fee * px * qty)
    return out


def summarize(trips):
    tot = {w: 0.0 for w, _, _ in WIN}
    cnt = {w: 0 for w, _, _ in WIN}
    months, years, by_k, by_sym, kinds = {}, {}, {}, {}, {}
    post = [0.0, 0]
    for t in trips:
        w = t["win"]
        if w is None:
            continue
        tot[w] += t["pnl"]
        cnt[w] += 1
        y = day_of(t["t"])[:4]
        years[y] = years.get(y, 0.0) + t["pnl"]
        if w != "IS":
            m = day_of(t["t"])[:7]
            months[m] = months.get(m, 0.0) + t["pnl"]
            by_k[str(t["k"])] = by_k.get(str(t["k"]), 0.0) + t["pnl"]
            by_sym[t["sym"]] = by_sym.get(t["sym"], 0.0) + t["pnl"]
            kinds[t["kind"]] = kinds.get(t["kind"], 0) + 1
        if day_of(t["t"]) >= POST_ROLLOUT:
            post[0] += t["pnl"]
            post[1] += 1
    oos = tot["OOS1"] + tot["OOS2"]
    best = max(months.values()) if months else 0.0
    oos_days = (ms("2026-09-22") - ms("2023-01-01")) / 86400000
    r = lambda x: round(x, 4)
    return {"pnl": {k: r(v) for k, v in tot.items()}, "trips": cnt, "oos_pnl": r(oos), "oos_trips": cnt["OOS1"] + cnt["OOS2"],
            "oos_months": {k: r(v) for k, v in sorted(months.items())}, "years": {k: r(v) for k, v in sorted(years.items())},
            "oos_by_rung": {k: r(v) for k, v in sorted(by_k.items())}, "oos_by_symbol": {k: r(v) for k, v in sorted(by_sym.items())},
            "oos_exit_kinds": kinds, "best_month": max(months, key=months.get) if months else None,
            "best_month_share": r(best / oos) if oos > 0 else None, "oos_without_best_month": r(oos - best),
            "ann_return_on_locked": round(oos / CAPITAL * 365 / oos_days, 6), "post_rollout": {"pnl": r(post[0]), "trips": post[1]}}


def main():
    arms = {"primary": {"fee": FEE, "hmult": 1.0, "cap": True, "close_twin": False},
            "doubled_costs": {"fee": 2 * FEE, "hmult": 2.0, "cap": True, "close_twin": False},
            "no_cap": {"fee": FEE, "hmult": 1.0, "cap": False, "close_twin": False},
            "close_twin": {"fee": FEE, "hmult": 1.0, "cap": True, "close_twin": True}}
    syms = sorted(days_in)
    res = {"test": "CB", "prereg_sha256": open(os.path.join(S, "prereg_cascade_bids.sha256")).read().strip(), "arms": {}, "symbols": len(syms)}
    all_trips = {}
    for a, arm in arms.items():
        tr = []
        for s in syms:
            tr += run_symbol(s, arm)
        tr.sort(key=lambda x: (x["t"], x["sym"], x["k"]))
        all_trips[a] = tr
        res["arms"][a] = summarize(tr)
    # null on the primary's OOS trips
    rng = random.Random(SEED)
    oos = [t for t in all_trips["primary"] if t["win"] in ("OOS1", "OOS2")]
    units = {}
    for t in oos:
        key = (t["sym"], t["k"], t["win"])
        if key not in units:
            units[key] = null_units(t["sym"], t["k"], t["win"], FEE, HS.get(t["sym"], 5.0) / 1e4)
    draws = []
    for _ in range(NULL_DRAWS):
        tot = 0.0
        for t in oos:
            u = units[(t["sym"], t["k"], t["win"])]
            if u:
                tot += u[rng.randrange(len(u))]
        draws.append(tot)
    draws.sort()
    res["null"] = {"draws": len(draws), "mean": round(sum(draws) / len(draws), 4) if draws else None,
                   "p50": round(draws[len(draws) // 2], 4) if draws else None, "p95": round(draws[int(0.95 * len(draws))], 4) if draws else None}
    p, dc = res["arms"]["primary"], res["arms"]["doubled_costs"]
    bar = {"1_oos_positive_each": p["oos_pnl"] > 0 and p["pnl"]["OOS1"] > 0 and p["pnl"]["OOS2"] > 0,
           "2_beats_null_p95": res["null"]["p95"] is not None and p["oos_pnl"] > res["null"]["p95"],
           "3_doubled_costs_positive": dc["oos_pnl"] > 0,
           "4_min_30_trips": p["oos_trips"] >= 30,
           "5_not_one_month": p["best_month_share"] is not None and p["best_month_share"] <= 0.40 and p["oos_without_best_month"] > 0,
           "6_beats_cash": p["ann_return_on_locked"] > 0.04}
    bar["PASS"] = all(bar.values())
    res["bar"] = bar
    res["trips_primary"] = all_trips["primary"]
    json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)
    print(json.dumps({"bar": bar, "primary": {k: p[k] for k in ("pnl", "trips", "oos_pnl", "best_month", "best_month_share", "ann_return_on_locked", "post_rollout")},
                      "null": res["null"], "doubled": dc["pnl"], "no_cap": res["arms"]["no_cap"]["pnl"], "close_twin": res["arms"]["close_twin"]["pnl"]}, indent=0))


if __name__ == "__main__":
    main()
