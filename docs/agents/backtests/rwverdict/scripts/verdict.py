"""RW's verdict of 2026-10-09 (the ledger's item 2, steps a, d, d2, d3 and g), from the day rows as they stand
(data/days.json: pm_rw_days, pm_rw_e_days and pm_rw_x_days with each row's detail.perMarket, read once after
2026-10-09 00:05 UTC by sql/days.sql). Each bar exactly as its frozen document words it:

  RW    reviews/2026-09-24-polymarket-rw-paper-spec.md        fourteen days 09-25 -> 10-08 (09-25 against 0)
  RW-E  reviews/2026-09-26-polymarket-rw-end-prereg.md        twelve days 09-27 -> 10-08 (from the 09-26 row), arm e
  X1-3  reviews/2026-09-27-polymarket-rw-variants-prereg.md   eleven days 09-28 -> 10-08 (from the 09-27 row)
  X4-5  reviews/2026-10-02-polymarket-rw-rest-prereg.md       Test 1: six days 10-03 -> 10-08 (from the 10-02 row),
                                                              with its Addendum 1 (the copy check on the 10-01 rows)

then RW-NEXT Part 1 (reviews/2026-09-28-rw-next-prereg.md) names the candidate. Each bootstrap is a fresh
random.Random of its document's seed, drawn as rw_test.py draws: sorted(sum(rng.choice(d) for _ in d) for _ in
range(2000)), the sum at int(0.05 * 2000) = 100 (RW-NEXT's paired one: seed 20261010, index 33).

usage: python3 -I scripts/verdict.py data/days.json > results/verdict.txt
"""
import gzip
import json
import os
import random
import sys

D = json.load(open(sys.argv[1])) if os.path.exists(sys.argv[1]) else json.loads(gzip.open(sys.argv[1] + ".gz").read())
num = lambda x: float(x)
rw = {r["day"][:10]: r for r in D["rw"]}
e_rows = {(r["arm"], r["day"][:10]): r for r in D["e"]}
x_rows = {(r["arm"], r["day"][:10]): r for r in D["x"]}
DAYS = ["2026-09-%02d" % d for d in range(25, 31)] + ["2026-10-%02d" % d for d in range(1, 9)]
TOL = 0.01
out = []
say = out.append


def boot(d, seed, idx=100, B=2000):
    rng = random.Random(seed)
    s = sorted(sum(rng.choice(d) for _ in d) for _ in range(B))
    return s[idx]


def bar(name, rows_by_day, days, base_row, seed, n_days, stress_ref=None, ref_name=None):
    """rows_by_day: day -> row of the arm; base_row: the row the change is taken from (None: against zero)."""
    first = base_row
    prev = first
    tots, strs = [], []
    for d in days:
        r = rows_by_day[d]
        tots.append(num(r["total"]) - (num(prev["total"]) if prev else 0.0))
        strs.append(num(r["stress_total"]) - (num(prev["stress_total"]) if prev else 0.0))
        prev = r
    last = rows_by_day[days[-1]]
    total = num(last["total"]) - (num(first["total"]) if first else 0.0)
    stress = num(last["stress_total"]) - (num(first["stress_total"]) if first else 0.0)
    fills = int(last["fills"]) - (int(first["fills"]) if first else 0)
    pm_last = last.get("perMarket") or {}
    pm_first = (first.get("perMarket") or {}) if first else {}
    per = {c: num(v["total"]) - num(pm_first.get(c, {"total": 0})["total"]) for c, v in pm_last.items()}
    for c, v in pm_first.items():
        if c not in per: per[c] = -num(v["total"])   # a market gone from the last row: what it held at the first is gone
    best_c = max(per, key=per.get) if per else None
    best = per[best_c] if per else 0.0
    cap = max(num(rows_by_day[d]["capital"]) for d in days)
    p5 = boot(tots, seed)
    ann = total / cap * 365 / n_days if cap > 0 else float("nan")
    conds = [("1 total > 0", total > 0, f"{total:.2f}"),
             ("2 stress total > 0", stress > 0, f"{stress:.2f}"),
             ("3 at least 100 fills", fills >= 100, f"{fills}"),
             ("4 no market over 50 % and the total without the best > 0", total > 0 and best <= 0.5 * total and total - best > 0,
              f"best {best:.2f} ({best / total * 100 if total else float('nan'):.1f} % of the total), without it {total - best:.2f}"),
             (f"5 bootstrap index 100 > 0 (seed {seed}, {len(tots)} days)", p5 > 0, f"{p5:.2f}"),
             (f"6 total on capital x 365 / {n_days} > 4 %", ann > 0.04, f"capital {cap:.2f}, {ann * 100:.1f} % a year")]
    if stress_ref is not None:
        conds.append((f"7 stress above {ref_name}'s over the same days", stress > stress_ref, f"{stress:.2f} against {stress_ref:.2f}"))
    ok = all(c[1] for c in conds)
    say(f"\n{name}: {'PASS' if ok else 'FAIL'} ({sum(c[1] for c in conds)} of {len(conds)})")
    say(f"  days {days[0]} -> {days[-1]} from {first['day'][:10] if first else 'zero'}; day totals {[round(x, 2) for x in tots]}")
    for c in conds: say(f"  {'ok  ' if c[1] else 'FAIL'} {c[0]}: {c[2]}")
    return {"pass": ok, "total": total, "stress": stress, "stress_days": strs, "fills": fills, "conds": [c[1] for c in conds]}


def check(label, a, b, days, fields=("total", "stress_total", "reward", "fills")):
    worst = 0.0
    for d in days:
        if d not in a or d not in b:
            say(f"  CHECK {label}: {d} missing ({'arm' if d not in a else 'reference'})"); return False, float("inf")
        for f in fields: worst = max(worst, abs(num(a[d][f]) - num(b[d][f])))
    say(f"  check {label}: largest gap over {len(days)} days ${worst:.2e}: {'ok' if worst < TOL else 'FAIL'}")
    return worst < TOL, worst


say(f"rows read {D['queried']}; RW's last minute {D['rwState']['last_minute']}, RW-E's {D['eState']['last_minute']}, the replay's {D['xState']['last_minute']}")
say(f"pm_rw_days rows: {', '.join(r['day'][:10] + ('(' + r['phase'] + ')' if r.get('phase') else '') for r in D['rw'])}")

# ---- (a) RW
say("\n=== (a) RW, by its spec ===")
R = bar("RW", rw, DAYS, None, 20261009, 14)

# ---- (d) RW-E
say("\n=== (d) RW-E, by its pre-registration ===")
e_e = {d: e_rows[("e", d)] for (a, d) in e_rows if a == "e"}
e_rw = {d: e_rows[("rw", d)] for (a, d) in e_rows if a == "rw"}
ok_e, gap_e = check("RW-E's replay, arm rw = pm_rw_days, 09-25 -> 10-08", e_rw, rw, DAYS)
E = None
if ok_e:
    rw_stress12 = num(rw["2026-10-08"]["stress_total"]) - num(rw["2026-09-26"]["stress_total"])
    E = bar("RW-E (arm e)", e_e, DAYS[2:], e_e["2026-09-26"], 20261009, 12, rw_stress12, "RW")
else:
    say("RW-E: VOID (its check failed)")

# ---- (d2) RW-X1-X3
say("\n=== (d2) RW-X1 to X3, by their pre-registration ===")
x = lambda arm: {d: x_rows[(arm, d)] for (a, d) in x_rows if a == arm}
ok_x1, g1 = check("RW-X's replay, arm rw = pm_rw_days, 09-25 -> 10-08", x("rw"), rw, DAYS)
ok_x2, g2 = check("RW-X's replay, arm e = pm_rw_e_days arm e, 09-25 -> 10-08", x("e"), e_e, DAYS)
X = {}
e_stress11 = num(e_e["2026-10-08"]["stress_total"]) - num(e_e["2026-09-27"]["stress_total"])
for arm in ("x1", "x2", "x3"):
    if ok_x1 and ok_x2:
        X[arm] = bar(f"RW-X {arm}", x(arm), DAYS[3:], x(arm)["2026-09-27"], 20261009, 11, e_stress11, "RW-E")
    else:
        say(f"{arm}: VOID (a check failed)")

# ---- (d3) RW-X4 and X5, Test 1
say("\n=== (d3) RW-X4 and X5, Test 1, by their pre-registration with its Addendum 1 ===")
ok_copy = True
for arm in ("x4", "x5"):
    a, b = x(arm).get("2026-10-01"), x("x1").get("2026-10-01")
    if not a or not b:
        say(f"  copy check {arm}: 10-01 row missing"); ok_copy = False; continue
    diffs = {f: abs(num(a[f]) - num(b[f])) for f in ("total", "stress_total", "reward", "fills", "capital", "markets")}
    good = all(v < 1e-9 for v in diffs.values())
    ok_copy = ok_copy and good
    say(f"  copy check {arm}: its 10-01 row equals x1's in total, stress_total, reward, fills, capital, markets: {'ok' if good else 'FAIL ' + json.dumps(diffs)}")
starts = {k: v for k, v in D["xState"]["arms"].items() if k in ("x4", "x5")}
say(f"  their arms in pm_rw_x_state now: {json.dumps(starts)} (no `start`; the slip rule's own facts are read from the record of 10-02, see the result file)")
x1_stress6 = num(x("x1")["2026-10-08"]["stress_total"]) - num(x("x1")["2026-10-02"]["stress_total"])
T1 = {}
for arm in ("x4", "x5"):
    if ok_x1 and ok_x2 and ok_copy:
        T1[arm] = bar(f"RW-X {arm}, Test 1", x(arm), DAYS[8:], x(arm)["2026-10-02"], 20261009, 6, x1_stress6, "x1")
    else:
        say(f"{arm}: VOID (a check failed)")
if not ok_copy:
    say("\n  Beside the void test, DESCRIPTIVE ONLY and not a verdict: the same seven conditions computed on the rows there are")
    for arm in ("x4", "x5"):
        if ok_x1 and ok_x2:
            d = bar(f"  (descriptive) RW-X {arm}, Test 1's arithmetic", x(arm), DAYS[8:], x(arm)["2026-10-02"], 20261009, 6, x1_stress6, "x1")
    say("  x1 over the same six days, for comparison:")
    bar("  (descriptive) RW-X x1 over 10-03 -> 10-08", x("x1"), DAYS[8:], x("x1")["2026-10-02"], 20261009, 6)

# ---- (g) RW-NEXT Part 1
say("\n=== (g) RW-NEXT Part 1: the candidate ===")
e_pass = bool(E and E["pass"])
rw_pass = R["pass"]   # its checks b and c (results/replay_record.json, results/prints_check.json) are read in the result file
cand = "RW-E" if e_pass else ("RW" if rw_pass else None)
say(f"  RW-E passes all seven: {e_pass}; RW passes all six: {rw_pass}; the candidate: {cand or 'none'}")
cand_stress = None
if cand == "RW-E":
    cand_stress = [num(e_e[d]["stress_total"]) - num(e_e[p]["stress_total"]) for p, d in zip(DAYS[2:-1], DAYS[3:])]
elif cand == "RW":
    cand_stress = [num(rw[d]["stress_total"]) - num(rw[p]["stress_total"]) for p, d in zip(DAYS[2:-1], DAYS[3:])]
qual = []
for arm in ("x1", "x2", "x3"):
    xs = [num(x(arm)[d]["stress_total"]) - num(x(arm)[p]["stress_total"]) for p, d in zip(DAYS[2:-1], DAYS[3:])]
    own = bool(X.get(arm) and X[arm]["pass"])
    if cand_stress is not None:
        dlt = [a - b for a, b in zip(xs, cand_stress)]
        rng = random.Random(20261010)
        sums = sorted(sum(rng.choice(dlt) for _ in dlt) for _ in range(2000))
        zeros = sum(1 for v in dlt if abs(v) < 1e-12)
        beats = sums[33] > 0
        say(f"  {arm}: passes its own seven {own}; paired stress against {cand} (09-28 -> 10-08): differences {[round(v, 2) for v in dlt]}, {zeros} zero, sum {sum(dlt):.2f}, index 33 {sums[33]:.2f}: {'beats' if beats else 'does not beat'}")
        if own and beats: qual.append(arm)
    else:
        say(f"  {arm}: passes its own seven {own}")
        if own: qual.append(arm)
if cand and qual:
    best = max(qual, key=lambda a: (X[a]["stress"], X[a]["total"], -int(a[1])))
    say(f"  1.3: {best} replaces {cand} as the candidate")
    cand = best
elif not cand and qual:
    best = max(qual, key=lambda a: (X[a]["stress"], X[a]["total"], -int(a[1])))
    say(f"  1.4: no candidate; {best} goes to Part 2 as a hypothesis")
say(f"\nRW-NEXT's candidate: {cand or 'none'}")
print("\n".join(out))
