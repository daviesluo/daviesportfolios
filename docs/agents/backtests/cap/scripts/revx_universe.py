# Revolut X UK book: which USD pairs carry >= $100k a day now (reference §4.15's liquidity test), against §3.8's 27.
# Inputs: revx/pairs_2026-10-01.json and revx/tickers_uk_2026-10-01.json, keyless GETs of 2026-10-01 ~00:4x UTC (one snapshot
# of a rolling 24 h; §3.8 used one snapshot too).
import json
import os
HERE = os.path.dirname(os.path.abspath(__file__))
pairs = json.load(open(f"{HERE}/../inputs/pairs_2026-10-01.json"))
tick = json.load(open(f"{HERE}/../inputs/tickers_uk_2026-10-01.json"))["data"]
S38 = ["BTC","ETH","BNB","XRP","SOL","HYPE","DOGE","LINK","ADA","XLM","UNI","NEAR","BCH","AVAX","LTC","SUI",
       "DOT","HBAR","TON","SHIB","PEPE","AAVE","ETC","ALGO","ICP","POL","ATOM"]
S38_VOL = {"BTC":3.6e6,"ETH":3.2e6,"SOL":3.3e6,"XRP":2.6e6,"AAVE":54e3,"DOGE":199e3,"LINK":693e3,"UNI":159e3,"ADA":122e3,"LTC":44e3,"BNB":19e3,
           "AVAX":1.9e6,"HBAR":114e3,"SHIB":11e3,"XLM":176e3,"PEPE":102e3,"DOT":769e3,"ALGO":180e3,"BCH":928e3,"ATOM":17e3,"SUI":942e3,"HYPE":123e3,
           "NEAR":2.8e6,"ICP":171e3,"ETC":8e3,"POL":11e3,"TON":8e3}
rows = []
for t in tick:
    if t.get("region") != "UK" or not t["symbol"].endswith("/USD"): continue
    b, a = float(t["bid"] or 0), float(t["ask"] or 0)
    mid = (a + b) / 2 if a > 0 and b > 0 else None
    spread = (a - b) / mid * 1e4 if mid else None
    base = t["symbol"].split("/")[0]
    cfg = pairs.get(t["symbol"], {})
    rows.append(dict(sym=base, qv=float(t.get("quote_volume_24h") or 0), spread=spread, status=cfg.get("status"), in38=base in S38, v38=S38_VOL.get(base)))
rows.sort(key=lambda r: -r["qv"])
print("UK USD pairs with a ticker:", len(rows), "| active in pair config:", sum(1 for r in rows if r["status"] == "active"))
print("pairs config entries:", len(pairs), "| USD quote:", sum(1 for k in pairs if k.endswith("/USD")))
over = [r for r in rows if r["qv"] >= 100e3]
print(f"\n>= $100k a day on the UK USD book now: {len(over)}")
print(f"{'coin':8}{'24h quote vol $':>16}{'spread bps':>11}  in §3.8's 27   §3.8 vol")
for r in over:
    print(f"{r['sym']:8}{r['qv']:>16,.0f}{(r['spread'] if r['spread'] is not None else float('nan')):>11.1f}  {'yes' if r['in38'] else 'NO':12}  {('$%.0fk' % (r['v38']/1e3)) if r['v38'] else ''}")
print("\n§3.8's 27 now (UK USD 24h quote volume):")
for c in S38:
    r = next((x for x in rows if x["sym"] == c), None)
    print(f"  {c:6} now {('$%.0fk' % (r['qv']/1e3)) if r else 'no UK USD ticker':>18}   §3.8 {('$%.0fk' % (S38_VOL[c]/1e3)) if c in S38_VOL else '-':>8}   spread {('%.1f' % r['spread']) if r and r['spread'] is not None else '-'} bps")
new_over = [r["sym"] for r in over if not r["in38"]]
crossed = [c for c in S38 if S38_VOL.get(c, 0) < 100e3 and any(x["sym"] == c and x["qv"] >= 100e3 for x in rows)]
print("\nover $100k now and NOT among §3.8's 27:", new_over)
print("among §3.8's 27, under $100k then and over it now:", crossed)
json.dump(dict(rows=rows, newOver=new_over, crossed=crossed), open(f"{HERE}/../results/revx_universe_out.json", "w"), indent=1)
