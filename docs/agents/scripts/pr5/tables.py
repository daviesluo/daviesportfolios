"""Markdown tables from results/pr5_run1.json (and the data checks) for report.md. usage: tables.py > results/tables.md"""
import json, os
S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = json.load(open(os.path.join(S, "results", "pr5_run1.json")))


def row(name, s):
    return (f"| {name} | {s['trips']} | {s['pnl_usd']:+.2f} | {s['win_rate'] if s['win_rate'] is not None else '–'} | "
            f"{s['worst_trip_usd']:+.2f} | {s['max_drawdown_usd']:.2f} | {s['taker_exits']} ({s['taker_exit_pnl_usd']:+.2f}) | "
            f"{s['median_hold_min'] if s['median_hold_min'] is not None else '–'} |")


H = "| | round trips | P&L $ | win rate | worst trip $ | max DD $ | taker exits (P&L $) | median hold (min) |\n|---|---|---|---|---|---|---|---|"
print("## Primary window\n")
print(H)
p = R["primary"]
print(row("**primary**", p["PRIMARY"]))
for arm in ("stress", "side_aware_fills", "no_post_only_block", "full_100_fills"):
    print(row(arm, R[arm]["PRIMARY"]))
print()
n = R["null_random_time"]
print(f"Null (random-time twins, {n['draws']} draws, seed {n['seed']}): mean {n['mean']:+.2f}, p50 {n['p50']:+.2f}, **p95 {n['p95']:+.2f}**, "
      f"max {n['max']:+.2f}; share of draws ≥ primary {n['share_draws_ge_primary']}.\n")
print("## The bar\n")
for k, v in R["bar"].items():
    print(f"* {k}: {'PASS' if v else 'FAIL'}")
print(f"* detail: {R['bar_detail']}\n")
print("## By month (entry month)\n")
print("| month | round trips | P&L $ | share of total | win rate | taker exits |\n|---|---|---|---|---|---|")
tot = p["PRIMARY"]["pnl_usd"]
for m, s in p["PRIMARY_by_month"].items():
    sh = f"{100 * s['pnl_usd'] / tot:.0f} %" if tot > 0 else "–"
    print(f"| {m} | {s['trips']} | {s['pnl_usd']:+.2f} | {sh} | {s['win_rate'] if s['win_rate'] is not None else '–'} | {s['taker_exits']} |")
print()
print("PR3 period, recomputed on prints (fresh from 2026-08-26):\n")
print("| month | round trips | P&L $ |\n|---|---|---|")
for m, s in p["PR3_period_by_month"].items():
    print(f"| {m} | {s['trips']} | {s['pnl_usd']:+.2f} |")
print()
print("## By book, rung, side (primary)\n")
print(H)
for grp in ("PRIMARY_by_book", "PRIMARY_by_rung", "PRIMARY_by_side"):
    for k, s in p[grp].items():
        print(row(k, s))
print()
print("## PR3's own period on prints\n")
print(H)
for k in ("PR3_period_all_28d", "PR3_period_IS", "PR3_period_OOS"):
    print(row(k, p[k]))
for arm in ("stress", "side_aware_fills", "no_post_only_block"):
    print(row(f"{arm} OOS", R[arm]["PR3_period_OOS"]))
print()
print("## Capacity (primary window, same 10 % cap)\n")
print("| rung | round trips | P&L $ | P&L/day $ | %/yr on locked capital | fill notional/day $ |\n|---|---|---|---|---|---|")
print(f"| $100 | {p['PRIMARY']['trips']} | {p['PRIMARY']['pnl_usd']:+.2f} | {p['PRIMARY']['pnl_usd_per_day']:+.4f} | {R['economics']['pnl_per_capital_year_pct']:.2f} | {p['PRIMARY']['fill_notional_usd_per_day']} |")
for k, s in R["capacity"].items():
    print(f"| ${k.split('_')[1]} | {s['trips']} | {s['pnl_usd']:+.2f} | {s['pnl_usd_per_day']:+.4f} | {s['return_per_year_on_locked_pct']:.2f} | {s['fill_notional_usd_per_day']} |")
print()
print(f"Economics: {R['economics']}")
print(f"Coverage: {R['coverage']}")
