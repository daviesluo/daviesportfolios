"""COMPOUND (2026-10-30): what reinvesting the realised P&L would have changed on the recorded history.

Davies, 2026-10-30: "另外再确认一下目前所有的live和testing的Stablecoin quotes都能有效做到盈利金额再利用吗？如果不能请研究实现".
Design: docs/agents/reviews/2026-10-30-compounding.md. The rule is 0146's (quotes_compound.ts `compoundPlan`): once a UTC day the
capital is base + realised, floored to whole units, between floor (base / 2) and cap (2 x base), moved only a step or more away.

The model: each recorded paper day's realised P&L as a share of the capital it ran on (P&L is linear in the rung size at these
sizes: a rung is far under the 10 % volume share that caps a fill), applied to the compounding capital of that day. Two series
(inputs/days.json): PR5's paper engine on Revolut X (37 days) and the Coinbase weekend arm (17 days); a day with no record is 0.
Each is run for every target's settings over the recorded days, and over a year made of the series repeated (a projection at
the recorded rate, not a forecast).

  python3 -I docs/agents/backtests/compound/scripts/replay.py   →  docs/agents/backtests/compound/results.json
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

TARGETS = {
    # name: (base, unit, step) — cap 2 x base, floor base / 2 (0146's £300 / £1,200 on £600).
    "LIVE USDT/GBP (Revolut X, £600)": (600, 12, 12),
    "USDC/GBP (Revolut X, £120)": (120, 4, 4),
    "USDC/GBP (Coinbase, £120)": (120, 6, 6),
    "variant-1 (£1,200)": (1200, 24, 24),
}


def plan(base, realised, current, unit, step):
    cap, floor = 2 * base, base / 2
    whole = math.floor((base + realised + 1e-9) / unit) * unit
    target = min(cap, max(floor, whole))
    return target if abs(target - current) + 1e-9 >= step and abs(target - current) > 1e-9 else current


def run(rates, base, unit, step):
    """rates: daily P&L per pound. Returns (fixed P&L, compounded P&L, final capital)."""
    fixed = sum(r * base for r in rates)
    cap, real = base, 0.0
    for r in rates:
        real += r * cap
        cap = plan(base, real, cap, unit, step)
    return fixed, real, cap


def main():
    days = json.load(open(os.path.join(ROOT, "inputs", "days.json")))
    out = {"_note": __doc__.strip().splitlines()[0], "series": {}}
    for name in ("pr5", "cbhold"):
        s = days[name]
        rates = [d[1] / s["capital"] for d in s["days"]]
        n = len(rates)
        year = (rates * (365 // n + 1))[:365]
        mean = sum(rates) / n
        res = {"days": n, "realised_pct_of_capital": round(100 * sum(rates), 3), "a_year_simple_pct": round(100 * mean * 365, 2), "targets": {}}
        for t, (base, unit, step) in TARGETS.items():
            f, c, end = run(rates, base, unit, step)
            fy, cy, endy = run(year, base, unit, step)
            res["targets"][t] = {
                "recorded": {"fixed_pct": round(100 * f / base, 3), "compounded_pct": round(100 * c / base, 3), "gain_pct_points": round(100 * (c - f) / base, 3),
                             "capital_end": end, "first_step_day": next((i + 1 for i in range(n) if run(rates[: i + 1], base, unit, step)[2] != base), None)},
                "a_year": {"fixed_pct": round(100 * fy / base, 2), "compounded_pct": round(100 * cy / base, 2), "gain_pct_points": round(100 * (cy - fy) / base, 2), "capital_end": endy},
            }
        out["series"][name] = res
    json.dump(out, open(os.path.join(ROOT, "results.json"), "w"), indent=1, ensure_ascii=False)
    json.dump(out, sys.stdout, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
