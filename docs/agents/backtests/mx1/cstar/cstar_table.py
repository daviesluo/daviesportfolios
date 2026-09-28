# The C* choice from results.json: every coin's 97.5 % bootstrap upper bound at each side's own deadline
# (entries T = 15, exits T = 60; the other deadline beside it), per rule and pooled over the rules as MX-1 counts events,
# the constant each reading implies (rounded UP to the next 10 bps), and the break-even miss rate at candidate constants.
import json, math

C = json.load(open("results.json"))["cells"]
COINS = ("BTC/USD", "ETH/USD", "SOL/USD")
up10 = lambda x: int(math.ceil(x / 10 - 1e-12) * 10)

for g, gname in (("ABC", "windows A–C"), ("ABCD", "windows A–D (D is outside the preferred span)")):
    print(f"\n**{gname}** — 97.5 % bootstrap upper bound of the mean chase, bps (misses in brackets); max per row; the constant it implies\n")
    print("| side | T | cell | BTC | ETH | SOL | max over coins | → C* |")
    print("|---|---|---|---|---|---|---|---|")
    for reason, Ts in (("entry", (15, 60)), ("exit", (60, 15))):
        for T in Ts:
            imp = []
            for rule in ("trend-4h", "trend-1h", "both"):
                vals = []
                for s in COINS:
                    c = C[f"{g}|{rule}|{reason}|T{T}|{s}"]
                    vals.append((c["upper975"], c["misses"]))
                m = max(v for v, _ in vals if v is not None)
                imp.append(m)
                cell = "both rules, one event per minute (MX-1 unit)" if rule == "both" else rule
                print(f"| {'entries (buy)' if reason == 'entry' else 'exits (sell)'} | {T} | {cell} | " +
                      " | ".join("—" if v is None else f"{v:.2f} ({n})" for v, n in vals) + f" | {m:.2f} | {up10(m)} |")
    print()

print("\n**Break-even miss rate s/(s + C*) with s = 11 bps, against the miss rates measured at the decision minutes (windows A–C, MX-1 unit)**\n")
print("| C* | break-even miss rate |")
print("|---|---|")
for cs in (60, 80, 90, 100, 110, 140, 180, 200):
    print(f"| {cs} | {100 * 11 / (11 + cs):.2f} % |")
print()
print("| side | T | pooled | BTC | ETH | SOL |")
print("|---|---|---|---|---|---|")
for reason in ("entry", "exit"):
    for T in (15, 60):
        row = [C[f"ABC|both|{reason}|T{T}|{s}"] for s in ("pooled",) + COINS]
        print(f"| {'entries' if reason == 'entry' else 'exits'} | {T} | " + " | ".join(f"{100 * c['missRate']:.1f} % ({c['misses']}/{c['n']})" for c in row) + " |")
