"""Post-run checks of the frozen run (descriptive; not part of the bar). usage: diagnostics.py -> results/diagnostics.json"""
import sys, os, json, datetime, statistics as st, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pr5_sim as P
S = P.S
q = lambda a, p: a[int(p * (len(a) - 1))] if a else None
fx = P.fx_series()
full = {b: P.Book(b, P.START[b], P.END, fx) for b in P.BOOKS}
D = {}
trips, orders = [], collections.Counter()
for b in P.BOOKS:
    tr, od = P.simulate(full[b]); trips += tr; orders.update(od)
day = lambda t: datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")
week = lambda t: datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%G-W%V")
# 1. the order budget
od = {datetime.datetime.fromtimestamp(d * 86400, datetime.timezone.utc).strftime("%Y-%m-%d"): n for d, n in orders.items()}
D["orders"] = {"days": len(od), "days_over_1000": sum(1 for n in od.values() if n > 1000), "days_over_700": sum(1 for n in od.values() if n > 700),
               "p50": q(sorted(od.values()), .5), "p90": q(sorted(od.values()), .9), "max": max(od.values()),
               "top_days": sorted(od.items(), key=lambda kv: -kv[1])[:8]}
# 2. P&L per week (entry week) across the whole continuous run, both books, and the books' buy-minus-sell gap that week
wk = collections.defaultdict(lambda: [0, 0.0])
for x in trips:
    w = week(x["t_entry"]); wk[w][0] += 1; wk[w][1] += x["pnl_usd"]
gap = collections.defaultdict(list)
for b in P.BOOKS:
    pr = full[b].all_prints
    for a, c in zip(pr, pr[1:]):
        if a[3] != c[3] and c[0] - a[0] <= 60000 and c[0] >= P.START[b]:
            buy = a if a[3] == "buy" else c; sell = c if a[3] == "buy" else a
            gap[week(c[0])].append((buy[1] - sell[1]) / ((buy[1] + sell[1]) / 2) * 1e4)
D["weekly"] = {w: {"trips": wk[w][0], "pnl_usd": round(wk[w][1], 2), "buy_minus_sell_bps_p50": round(st.median(gap[w]), 1) if gap[w] else None,
                   "pairs": len(gap[w])} for w in sorted(set(wk) | set(gap))}
# 3. concentration and outliers
P_ = [x for x in trips if P.START[x["book"]] <= x["t_entry"] < P.PRIM_END]
pn = sorted((x["pnl_usd"] for x in P_), reverse=True)
tot = sum(pn)
D["concentration"] = {"trips": len(pn), "total": round(tot, 2), "top_1pct_share": round(sum(pn[:len(pn) // 100]) / tot, 4),
                      "top_10pct_share": round(sum(pn[:len(pn) // 10]) / tot, 4), "best": round(pn[0], 4),
                      "mean_per_trip": round(tot / len(pn), 5)}
# 4. how far through the quote the filling print was, and the P&L from deep prints
depth = []
for x in P_:
    B = full[x["book"]]; i = (x["t_entry"] - B.t0) // P.M
    pt = round(x["entry"] / P.TICK)
    cand = [p for p in B.by_min[i] if p[0] == x["fill_ts"] and ((p[1] < pt) if x["side"] == "bid" else (p[1] > pt))]
    d = max(abs(p[1] - pt) for p in cand) * P.TICK / x["entry"] * 1e4
    depth.append((d, x["pnl_usd"]))
ds = sorted(d for d, _ in depth)
D["fill_print_depth_bps"] = {"p10": round(q(ds, .1), 1), "p50": round(q(ds, .5), 1), "p90": round(q(ds, .9), 1), "p99": round(q(ds, .99), 1),
                             "pnl_from_fills_deeper_than_50bps": round(sum(p for d, p in depth if d > 50), 2),
                             "trips_deeper_than_50bps": sum(1 for d, _ in depth if d > 50)}
# 5. hour of day / weekday of entries
D["entries_by_weekday"] = dict(collections.Counter(datetime.datetime.fromtimestamp(x["t_entry"] / 1000, datetime.timezone.utc).strftime("%a") for x in P_))
# 6. pnl per day by month (continuous run, entry month), to show the trend
bym = collections.defaultdict(lambda: [0, 0.0, set()])
for x in trips:
    m = datetime.datetime.fromtimestamp(x["t_entry"] / 1000, datetime.timezone.utc).strftime("%Y-%m")
    bym[m][0] += 1; bym[m][1] += x["pnl_usd"]
D["continuous_by_month"] = {m: {"trips": v[0], "pnl_usd": round(v[1], 2)} for m, v in sorted(bym.items())}
json.dump(D, open(os.path.join(S, "results", "diagnostics.json"), "w"), indent=1, sort_keys=True)
print(json.dumps({k: v for k, v in D.items() if k != "weekly"}, indent=0)[:3000])
for w, v in D["weekly"].items():
    if w >= "2026-W27": print(w, v)
