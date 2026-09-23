"""POST-HOC, descriptive (written after the frozen run, not part of the bar): the rule in the tight regime that began
the week of 2026-08-24 — the PR3-period simulation (fresh from 2026-08-26) at larger rungs, and orders a day there.
usage: posthoc_new_regime.py -> results/posthoc_new_regime.json"""
import sys, os, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pr5_sim as P
fx = P.fx_series()
B = {b: P.Book(b, P.PR3_0, P.END, fx) for b in P.BOOKS}
days = (P.END - P.PR3_0) / 86400000
out = {}
for size in (100.0, 300.0, 1000.0, 3000.0):
    trips, orders = [], collections.Counter()
    for b in P.BOOKS:
        tr, od = P.simulate(B[b], size=size); trips += tr; orders.update(od)
    s = P.summarize(trips, P.PR3_0, P.END, 12 * size, days)
    s["pct_per_year_on_locked"] = round(100 * s["pnl_usd"] / (12 * size) * 365 / days, 2)
    s["orders_per_day_mean"] = round(sum(orders.values()) / days, 1); s["orders_per_day_max"] = max(orders.values())
    out[f"rung_{int(size)}"] = s
json.dump(out, open(os.path.join(P.S, "results", "posthoc_new_regime.json"), "w"), indent=1, sort_keys=True)
for k, s in out.items():
    print(k, s["trips"], s["pnl_usd"], s["pnl_usd_per_day"], s["pct_per_year_on_locked"], s["orders_per_day_mean"], s["orders_per_day_max"])
