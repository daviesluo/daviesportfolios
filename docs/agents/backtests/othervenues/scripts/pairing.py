"""Does EURC-USDC's daily P&L move with what already runs? Correlations of daily P&L by entry day, over the days both
records cover, with SCQ-VENUES' committed daily series (scq_venues/results/daily_100.json, £100 a rung, to 2026-10-09)
and CJ5's PR5-on-Revolut-X run (scq_venues/results/pr5_revx_daily_100.json, 2025-11-26 -> 10-08). Also each series'
rate over the same days, in bps of its capital a day, so books of different rung sizes compare.
usage: python3 -I pairing.py   -> ../results/pairing.json
"""
import datetime, json, os, statistics as st

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCQ = os.path.normpath(os.path.join(ROOT, "..", "scq_venues", "results"))
mine = json.load(open(os.path.join(ROOT, "results", "daily_50.json")))
scq = json.load(open(os.path.join(SCQ, "daily_100.json")))["daily"]
pr5 = json.load(open(os.path.join(SCQ, "pr5_revx_daily_100.json")))["daily"]
A, Z = datetime.date(2025, 11, 26), datetime.date(2026, 10, 8)
days = [(A + datetime.timedelta(d)).isoformat() for d in range((Z - A).days + 1)]
series = {"coinbase:EURC-USDC (£50)": (mine["coinbase:EURC-USDC"], 300.0), "revx PR5 USDC+USDT-GBP (£100)": (pr5, 1200.0)}
for k in ("coinbase:USDC-GBP", "coinbase:USDT-GBP", "coinbase:USDC-EUR", "coinbase:USDT-EUR", "okx:USDG-EUR", "bitstamp:usdceur"):
    series[k + " (£100)"] = (scq[k], 600.0)


def corr(a, b):
    ma, mb = st.mean(a), st.mean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = (sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b)) ** 0.5
    return round(num / den, 3) if den else None


vec = {k: [s.get(d, 0.0) for d in days] for k, (s, _) in series.items()}
wk = lambda v: [sum(v[i:i + 7]) for i in range(0, len(v) - 6, 7)]
base = "coinbase:EURC-USDC (£50)"
out = {"days": [days[0], days[-1], len(days)], "rate_bps_of_capital_a_day": {}, "corr_with_eurc_daily": {}, "corr_with_eurc_weekly": {}}
for k, (s, cap) in series.items():
    out["rate_bps_of_capital_a_day"][k] = round(1e4 * sum(vec[k]) / len(days) / cap, 3)
    if k != base:
        out["corr_with_eurc_daily"][k] = corr(vec[base], vec[k])
        out["corr_with_eurc_weekly"][k] = corr(wk(vec[base]), wk(vec[k]))
json.dump(out, open(os.path.join(ROOT, "results", "pairing.json"), "w"), indent=1, sort_keys=True)
print(json.dumps(out, indent=1))
