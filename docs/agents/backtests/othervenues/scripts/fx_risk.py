"""What the inventory's currency costs in pounds a day, against the edge. A GBP book (USDC-GBP) holds about half its
capital in dollar coins; a pegged cross held from pounds (EURC-USDC) holds all of it abroad, about half in euros and half
in dollars. Daily changes of the pound value of each inventory, from the committed FX minutes (the 12:00 UTC value of each
weekday, 2025-10-27 -> 2026-10-27): the standard deviation in bps of the capital a day, beside the edge in the same unit.
usage: python3 -I fx_risk.py   -> ../results/fx_risk.json
"""
import bisect, datetime, json, os, statistics as st, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ov_inputs as OI  # noqa: E402

ROOT = os.path.dirname(HERE)
gt, gv = OI.load_gbpusd()
et, ev = OI.load_eurusd()


def at(ts, vs, t):
    k = bisect.bisect_right(ts, t) - 1
    return vs[k] if k >= 0 and ts[k] >= t - 30 * 60000 else None


rows = []
d = datetime.date(2025, 10, 27)
while d < datetime.date(2026, 10, 27):
    if d.weekday() < 5:
        t = int(datetime.datetime(d.year, d.month, d.day, 12, tzinfo=datetime.timezone.utc).timestamp() * 1000)
        g, e = at(gt, gv, t), at(et, ev, t)
        if g and e:
            rows.append((d.isoformat(), g, e))
    d += datetime.timedelta(1)
usd_in_gbp = [1 / g for _, g, _ in rows]
eur_in_gbp = [e / g for _, g, e in rows]
ch = lambda v: [1e4 * (v[i] / v[i - 1] - 1) for i in range(1, len(v))]
half_usd = [0.5 * x for x in ch(usd_in_gbp)]                      # a GBP book: half the capital in dollar coins
cross = [0.5 * a + 0.5 * b for a, b in zip(ch(usd_in_gbp), ch(eur_in_gbp))]   # EURC-USDC from pounds: half euros, half dollars
res = {"weekdays": len(rows), "from": rows[0][0], "to": rows[-1][0],
       "sd_bps_of_capital_a_day": {"GBP book (half in USD coins)": round(st.pstdev(half_usd), 2),
                                   "EURC-USDC held from GBP (half EUR, half USD)": round(st.pstdev(cross), 2),
                                   "USD alone": round(st.pstdev(ch(usd_in_gbp)), 2), "EUR alone": round(st.pstdev(ch(eur_in_gbp)), 2)},
       "note": "the edge in the same unit is in ov.json (bps_per_day_of_capital): EURC-USDC 2.24 over 12 months at £50"}
json.dump(res, open(os.path.join(ROOT, "results", "fx_risk.json"), "w"), indent=1, sort_keys=True)
print(json.dumps(res, indent=1))
