# Markdown tables from results.json (written by cstar.py). Prints to stdout.
import json, math

R = json.load(open("results.json"))
C = R["cells"]
SC = ("pooled", "BTC/USD", "ETH/USD", "SOL/USD")


def f(x, nd=1, pct=False):
    if x is None: return "—"
    return f"{100 * x:.{nd}f} %" if pct else f"{x:.{nd}f}"


def row(label, c):
    return (f"| {label} | {c['n']} | {c['misses']} | {f(c['missRate'], 1, True)} | {f(c['meanChase'])} | {f(c['medianChase'])} | "
            f"{f(c['p90Chase'])} | **{f(c['upper975'])}** | {f(c['maxChase'])} | {f(c['meanSaving'], 3)} | {f(c['meanAdvantage'], 2)} | "
            f"{f(c.get('breakEvenMissRate'), 1, True)} |")


HEAD = ("| | decisions | misses | miss rate | mean chase | median | p90 | 97.5 % upper of mean | max | saving if filled | mean A_T per event | break-even miss rate |\n"
        "|---|---|---|---|---|---|---|---|---|---|---|---|")


def block(group, rule, reason, T, title):
    print(f"\n**{title}**\n")
    print(HEAD)
    for s in SC:
        k = f"{group}|{rule}|{reason}|T{T}|{s}"
        if k in C: print(row(s.replace("/USD", ""), C[k]))


side_name = {"entry": "entries (buy)", "exit": "rule exits (sell)"}
for group, gname in (("ABC", "windows A–C, 2023-08-22 → 2026-09-20"), ("D", "window D (supplement), 2022-08-22 → 2023-08-21")):
    print(f"\n## {gname}\n")
    for reason in ("entry", "exit"):
        for T in (15, 60):
            for rule in ("trend-4h", "trend-1h", "both"):
                block(group, rule, reason, T, f"{rule} · {side_name[reason]} · T = {T}")
            for lab in ("random-4h", "random-hour"):
                block(group, lab, reason, T, f"{'every 4-hour close' if lab == 'random-4h' else 'every hour close'} · {'buy' if reason == 'entry' else 'sell'} · T = {T}")

print("\n## per window, coins pooled\n")
print("| window | side | T | trend-4h: n / miss / mean chase / 97.5 % | trend-1h: n / miss / mean chase / 97.5 % | every 4h close: n / miss / mean chase | every hour close: n / miss / mean chase |")
print("|---|---|---|---|---|---|---|")
for w in "ABCD":
    for reason in ("entry", "exit"):
        for T in (15, 60):
            parts = []
            for lab in ("trend-4h", "trend-1h", "random-4h", "random-hour"):
                c = C.get(f"win{w}|{lab}|{reason}|T{T}|pooled")
                if not c or not c["n"]: parts.append("—"); continue
                s = f"{c['n']} / {f(c['missRate'], 1, True)} / {f(c['meanChase'])}"
                if not lab.startswith("random"): s += f" / {f(c['upper975'])}"
                parts.append(s)
            print(f"| {w} | {'buy' if reason == 'entry' else 'sell'} | {T} | " + " | ".join(parts) + " |")
