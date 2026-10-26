"""2026-10-26 review: LIVE's realised over 10-19 -> 10-25 recomputed without the page's code, from the fills' cash flows.

Each rung's fills in time order; a trip closes when the rung is back within its book's dust (0.135 coin); what it made is
the cash it moved plus the hair left at the last price. Prints the window's realised as a share of the £120 capital and its
simple annualised rate, to compare with the page's 64.91 % (results/summary.json, page_figure). Conversion fees are left out
(the page books them into the trips that sold the converted coins); over this week the two agree to 0.01 % a year (64.90).
Run from this folder: python3 -I scripts/cashflow_check.py
"""
import gzip, json, pathlib
from collections import defaultdict

HERE = pathlib.Path(__file__).resolve().parent.parent
orders = json.loads(gzip.open(HERE / "data/live_orders.json.gz").read())
rungs = defaultdict(list)
for x in orders:
    if x["leg"] in ("entry", "exit", "stop") and float(x["filled_base"] or 0) > 0:
        rungs[(x["book"], x["rung_side"], float(x["k"]))].append(x)
window = 0.0
for fs in rungs.values():
    fs.sort(key=lambda x: (x["filled_at"] or x["ts"], x["id"]))
    pos = cash = 0.0
    for f in fs:
        q, p, fee = float(f["filled_base"]), float(f["avg_fill_price"] or f["price"]), float(f["fee_gbp"] or 0)
        sgn = 1 if f["side"] == "buy" else -1
        pos += sgn * q
        cash += -sgn * q * p - fee
        if abs(pos) < 0.135:
            if "2026-10-19" <= (f["filled_at"] or f["ts"]) < "2026-10-26":
                window += cash + pos * p
            cash = -pos * p
print(f"10-19 -> 10-25 realised: {window / 120 * 100:.4f} % of the capital; simple annualised {window / 120 * 365 / 7 * 100:.2f} %")
