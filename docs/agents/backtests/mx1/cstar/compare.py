# Decision minutes against every hour / 4-hour close over windows A-C: the difference in miss rate (two-proportion z)
# and in mean chase given a miss (bootstrap 95 % interval of the difference, 4,000 resamples of each sample,
# random.Random(1)). Reads results.json's per-event record and recomputes the random-close events with cstar.Tape.
import json, math, random, statistics as st
from cstar import Tape, PAIR, ms

R = json.load(open("results.json"))
ev = R["events"]
A, B = ms("2023-08-22T00:00Z"), ms("2026-09-20T04:00Z")
tapes = {s: Tape(PAIR[s]) for s in PAIR}


def dedup(evs):
    seen, out = set(), []
    for e in sorted(evs, key=lambda e: (e["decisionTs"], e["rule"] != "trend-4h")):
        k = (e["symbol"], e["reason"], e["decisionTs"])
        if k not in seen: seen.add(k); out.append(e)
    return out


def rand(step, side, T, sym=None):
    out = []
    for s, t in tapes.items():
        if sym and s != sym: continue
        for x in range((A + step - 1) // step * step, B, step):
            r = t.event(x, side, T)
            if r[0] != "nodata": out.append(r)
    return out


def diff(dec, rnd):
    c1 = [v for s, v in dec if s == "miss"]; c0 = [v for s, v in rnd if s == "miss"]
    p1, p0 = len(c1) / len(dec), len(c0) / len(rnd)
    p = (len(c1) + len(c0)) / (len(dec) + len(rnd))
    z = (p1 - p0) / math.sqrt(p * (1 - p) * (1 / len(dec) + 1 / len(rnd)))
    rng = random.Random(1)
    d = sorted(sum(rng.choices(c1, k=len(c1))) / len(c1) - sum(rng.choices(c0, k=len(c0))) / len(c0) for _ in range(4000))
    return p1, p0, z, st.mean(c1), st.mean(c0), d[int(0.025 * 4000)], d[int(0.975 * 4000)]


print("| decisions | against | side | T | miss rate: decisions / random (z) | mean chase: decisions / random | difference, 95 % bootstrap interval |")
print("|---|---|---|---|---|---|---|")
for label, rules, step, against in (("both rules (MX-1 unit)", ("trend-4h", "trend-1h"), 3600000, "every hour close"),
                                    ("trend-4h", ("trend-4h",), 4 * 3600000, "every 4-hour close"),
                                    ("trend-1h", ("trend-1h",), 3600000, "every hour close")):
    for reason, side in (("entry", "buy"), ("exit", "sell")):
        for T in (15, 60):
            sel = [e for e in ev if e["rule"] in rules and e["reason"] == reason and e["window"] in "ABC"]
            if len(rules) > 1: sel = dedup(sel)
            dec = [e[f"T{T}"] for e in sel]
            p1, p0, z, m1, m0, lo, hi = diff(dec, rand(step, side, T))
            print(f"| {label} | {against} | {side} | {T} | {100 * p1:.1f} % / {100 * p0:.1f} % (z = {z:+.2f}) | {m1:.1f} / {m0:.1f} | {m1 - m0:+.1f} [{lo:+.1f}, {hi:+.1f}] |")
