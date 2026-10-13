"""PMOPPS: does a reward market's AGE (POOLAGE, ledger item 6b) say where quoting pays? LP-BEST's day table, by age.

LP-BEST's `daytable_api.csv.gz` (its scripts/daytable.py, the engine's fill rule, k_vol, R in the engine's units) has
every market-day of live-prep's universe (rate >= $10, N <= 20, no weather, no AI, no game within two days, 10-05 ->
10-12) quoted statelessly at five placements: the formula on minutes at least two ticks wide (`*_f2w`), the fills' 60-
and 240-minute markouts (`*_mo60w`, `*_mo240`). Net a market-day = R x formula + markout, R = 0.42 (LP-BEST's live R).
Here each market-day gets the market's age at 00:00 of that day from Gamma's `createdAt` (keyless, cached in
$PM_DATA/created.json), and the net is read by age, on all market-days and on LP-BEST's quiet books (the prior 24 h's
data-API volume <= 50 shares and a touch >= 4 c at 00:00).

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/pool_age.py <daytable_api.csv.gz>
"""
import csv
import gzip
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402

R = 0.42
GAMMA = "https://gamma-api.polymarket.com"
rows = list(csv.DictReader(gzip.open(sys.argv[1], "rt")))
conds = sorted({r["cond"] for r in rows})
path = os.path.join(pmnet.DATA, "created.json")
created = json.load(open(path)) if os.path.exists(path) else {}
todo = [c for c in conds if c not in created]
for closed in (None, "true"):
    for i in range(0, len(todo), 50):
        chunk = [c for c in todo[i:i + 50] if c not in created]
        if not chunk: continue
        params = {"condition_ids": chunk, "limit": 100}
        if closed: params["closed"] = closed
        for m in pmnet.get(GAMMA + "/markets", params):
            created[m["conditionId"]] = m.get("createdAt")
pmnet.dump(path, created)


def ep(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def f(x):
    try: return float(x)
    except (TypeError, ValueError): return 0.0


AGES = [(0, 1, "under 1 day"), (1, 3, "1-3 days"), (3, 7, "3-7 days"), (7, 30, "7-30 days"), (30, 1e9, "30 days +")]
PL = ["inside", "join", "behind1", "behind2"]
for lab, keep in (("every market-day", lambda r: True),
                  ("quiet books (prior 24 h <= 50 shares, touch >= 4 c)", lambda r: f(r["p_vol"]) <= 50 and f(r["width0_c"]) >= 4 - 1e-9)):
    print(f"\n== {lab}. $ over the 8 days (net = {R} x formula + 60-min markout; 240 min in brackets), and a market-day")
    print(f"{'age at 00:00':<14}{'mkt-days':>9}" + "".join(f"{p:>26}" for p in PL) + f"{'taker shares/day':>18}")
    for a0, a1, name in AGES:
        rs = [r for r in rows if keep(r) and created.get(r["cond"]) and a0 <= (ep(r["day"] + "T00:00:00+00:00") - ep(created[r["cond"]])) / 86400 < a1]
        if not rs: continue
        cells = ""
        for p in PL:
            n60 = sum(R * f(r[f"{p}_f2w"]) + f(r[f"{p}_mo60w"]) for r in rs)
            n240 = sum(R * f(r[f"{p}_f2w"]) + f(r[f"{p}_mo240"]) for r in rs)
            cells += f"{n60:>10.2f} ({n240:>8.2f}) {n60 / len(rs):>+6.3f}"
        print(f"{name:<14}{len(rs):>9}{cells}{sum(f(r['d_vol']) for r in rs) / len(rs):>18.0f}")
    miss = sum(1 for r in rows if keep(r) and not created.get(r["cond"]))
    print(f"(market-days with no createdAt: {miss})")
