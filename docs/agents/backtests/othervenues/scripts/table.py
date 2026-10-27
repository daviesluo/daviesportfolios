"""The review's tables from ../results/ov.json -> ../results/table.md (and printed).
usage: python3 -I table.py
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = json.load(open(os.path.join(ROOT, "results", "ov.json")))
out = []
P = out.append
ORDER = ["coinbase:EURC-USDC", "okx:EURC-USDC", "okx:USDG-EUR", "bitstamp:eurcvusdc", "coinbase:TGBP-USDC", "coinbase:USDC-GBP", "coinbase:USDT-GBP",
         "revx:USDC-GBP", "revx:USDT-GBP"]
books = [k for k in ORDER if k in R["books"]]

P("## A. Each book at £50 a rung (£300), fills strictly through the quote\n")
P("| book | from | £/day traded (window) | lit | trips | stops | bps a trip | £ a day | bps of capital a day | % a year | days + / − | bootstrap p05–p95 £/day |")
P("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|")
for k in books:
    b = R["books"][k]
    for w in ("whole", "since_08-24", "last_28d"):
        x = b["arms"]["through_50"]["windows"].get(w)
        if not x or (w != "whole" and x["from"] == b["arms"]["through_50"]["windows"]["whole"]["from"]):
            continue
        bs = b["arms"]["through_50"]["bootstrap_whole" if w == "whole" else "bootstrap_last_28d"] if w in ("whole", "last_28d") else None
        vol = b["meta"]["volume_gbp_per_day"].get({"whole": "12m", "since_08-24": "since_08-24", "last_28d": "last_28d"}[w])
        if vol is None and w == "whole":
            vol = b["meta"]["volume_gbp_per_day"].get("since_tgbp") or b["meta"]["volume_gbp_per_day"].get("last_28d")
        P(f"| {k} | {x['from']} ({x['days']:.0f} d) | {vol if vol is not None else '—'} | {b['meta']['lit_share']:.2f} | {x['trips']} | {x['stops']} | "
          f"{x['bps_per_trip']} | {x['gbp_per_day']:.3f} | {x['bps_per_day_of_capital']:.2f} | {x['pct_per_year']:.1f} % | {x['days_positive']} / {x['days_negative']} | "
          + (f"{bs['p05_gbp_per_day']:.3f} – {bs['p95_gbp_per_day']:.3f}" if bs else "—") + " |")

P("\n## B. Arms, whole window, % a year on the arm's capital (6 rungs)\n")
P("| book | £10 | £50 | £100 | at price £50 | stress £50 | £300 | £1,000 |")
P("|---|---:|---:|---:|---:|---:|---:|---:|")
for k in books:
    a = R["books"][k]["arms"]
    f = lambda n: f"{a[n]['windows']['whole']['pct_per_year']:.1f} %"
    P(f"| {k} | {f('through_10')} | {f('through_50')} | {f('through_100')} | {f('at_price_50')} | {f('stress_50')} | {f('through_300')} | {f('through_1000')} |")

P("\n## C. By rung k, whole window, £50 through: trips / £\n")
P("| book | k 0.1 % | k 0.2 % | k 0.3 % | bids £ | asks £ |")
P("|---|---|---|---|---:|---:|")
for k in books:
    x = R["books"][k]["arms"]["through_50"]["windows"]["whole"]
    c = lambda r: f"{x['by_k'][r]['trips']} / £{x['by_k'][r]['pnl_gbp']:.2f}"
    P(f"| {k} | {c('0.1%')} | {c('0.2%')} | {c('0.3%')} | {x['by_side']['bid']:.2f} | {x['by_side']['ask']:.2f} |")

P("\n## D. Prints against fair (bps, the minute's last print; median and p10 / p90 by month)\n")
for k in books:
    pc = R["books"][k]["meta"]["peg_check_bps"]
    P(f"- {k}: " + "; ".join(f"{m} {v['median']} ({v['p10']} / {v['p90']}, n {v['n']})" for m, v in pc.items()))

P("\n## E. By month, £50 through, £\n")
for k in books:
    bm = R["books"][k]["arms"]["through_50"]["by_month"]
    P(f"- {k}: " + ", ".join(f"{m} {v:.2f}" for m, v in bm.items()))
txt = "\n".join(out) + "\n"
open(os.path.join(ROOT, "results", "table.md"), "w").write(txt)
print(txt)
