# The four main tables of REPORT.md (windows A–C): one per side × deadline, decision minutes per rule and on MX-1's
# unit, then every 4-hour and every hour close over the same span. Reads results.json.
import json

C = json.load(open("results.json"))["cells"]
SC = (("pooled", "all 3"), ("BTC/USD", "BTC"), ("ETH/USD", "ETH"), ("SOL/USD", "SOL"))
f = lambda x, nd=1: "—" if x is None else f"{x:.{nd}f}"
pct = lambda x: "—" if x is None else f"{100 * x:.1f} %"
ROWS = (("trend-4h", "trend-4h decisions"), ("trend-1h", "trend-1h decisions"), ("both", "both rules, MX-1 unit"),
        ("random-4h", "every 4-hour close"), ("random-hour", "every hour close"))
for reason, side in (("entry", "entries (buy)"), ("exit", "rule exits (sell)")):
    for T in ((15, 60) if reason == "entry" else (60, 15)):
        print(f"\n**{side}, T = {T} min** (windows A–C)\n")
        print("| minutes | coin | n | misses | miss rate | mean chase | median | p90 | **97.5 % upper (bootstrap)** | t 97.5 % upper | max | mean A_T | break-even miss rate |")
        print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for key, label in ROWS:
            for s, sname in SC:
                c = C[f"ABC|{key}|{reason}|T{T}|{s}"]
                print(f"| {label} | {sname} | {c['n']} | {c['misses']} | {pct(c['missRate'])} | {f(c['meanChase'])} | {f(c['medianChase'])} | "
                      f"{f(c['p90Chase'])} | **{f(c['upper975'])}** | {f(c.get('upperT975'))} | {f(c['maxChase'])} | {f(c['meanAdvantage'], 2)} | "
                      f"{pct(c.get('breakEvenMissRate'))} |")
