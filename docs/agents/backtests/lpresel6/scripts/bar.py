"""LPRESEL6's checks and bar (reviews/2026-10-09-lp-reselect6h-prereg.md), on results/<name>_arms.json (scripts/run.ts),
the built record's coverage (data/pr_record.json) and the archive index (data/pmrec/index.json, every object re-hashed).

usage: python3 -I scripts/bar.py results/rwc_window_arms.json data/pr_record.json data/pmrec data/aux.json

Checks, before the bar:
  coverage   every UTC day 2026-10-09 -> 10-22 has a books minute recorded in at least 1,296 of 1,440 (90 %), at most two
             days under 1,368 (95 %); every books, universe and prints object of the window's 336 hours is in the index
             and its file's sha256 is the index's. Otherwise the test is VOID.
  reproduce  REPORTED, NOT A VOID CONDITION: L1's markets each day against live-prep's own selection (pm_lp_markets) and
             L1's formula rewards against live-prep's paper days (pm_lpprep_days.reward). The record is a reconstruction
             (ten-cent ladders read at the recorder's second, slots every two hours, the listing as the recorder last read
             it), so it cannot reproduce the path; on 2026-10-05 -> 10-08 it chose 2, 2, 9 and 7 of the path's ten.
The bar (each of the three, under each fill model, at R = 0.40, a day's figure its total less 0.6 of its rewards):
  1  a fresh random.Random(20261023), 2,000 draws of len(D) choices of D_i = RESEL6's day less L1's, the sums sorted,
     the one at index 100 > 0;
  2  over every market of either arm and every day, d_{c,i} = RESEL6's market-day less L1's; their sum less the largest > 0;
  3  RESEL6's worst day no worse than L1's.
RESEL6 passes when all six hold (three conditions, two fill models).
"""
import gzip
import hashlib
import json
import os
import random
import sys

arms_file, record_file, pmrec_dir, aux_file = sys.argv[1:5]
A = json.load(open(arms_file))["arms"]
rec = json.load(open(record_file))
days = ["2026-10-%02d" % d for d in range(9, 23)]
void = []

print("=== checks ===")
cov = rec.get("coverage", {})
under95 = [d for d in days if cov.get(d, 0) < 1368]
under90 = [d for d in days if cov.get(d, 0) < 1296]
print("coverage (book minutes of 1,440):", ", ".join(f"{d[5:]} {cov.get(d, 0)}" for d in days))
if under90 or len(under95) > 2:
    void.append(f"coverage: under 90 % on {under90 or 'none'}, under 95 % on {under95}")
idx = json.load(open(os.path.join(pmrec_dir, "index.json")))
need = {(k, f"{d}T{h:02d}") for k in ("books", "universe", "prints") for d in days for h in range(24)}
have = {}
for o in idx:
    key = (o["kind"], o["hour"][:13].replace(" ", "T"))
    if key in need:
        have[key] = o
missing = sorted(need - set(have))
bad = []
for (k, h), o in have.items():
    f = os.path.join(pmrec_dir, f"{k}_{h.replace(':', '')}.gz")
    if not os.path.exists(f) or hashlib.sha256(open(f, "rb").read()).hexdigest() != o.get("sha256"):
        bad.append(f"{k} {h}")
print(f"archive: {len(have)} of {len(need)} objects in the index, {len(missing)} missing, {len(bad)} failing their sha256")
if missing or bad:
    void.append(f"archive: missing {missing[:6]}, failing {bad[:6]}")
aux = json.load(open(aux_file)) if os.path.exists(aux_file) else json.loads(gzip.open(aux_file + ".gz").read())
own = {}
for m in aux.get("lp_markets") or []:
    own.setdefault(str(m["day"])[:10], set()).add(m["cond"])
paper = {str(d["day"])[:10]: float(d["reward"]) for d in aux.get("lp_days") or []}
l1 = A["L1 | strict"]
print("reproduce (reported, decides nothing): day, L1's markets also live-prep's, L1's formula rewards against the paper's")
for d in l1["days"]:
    ch = set(l1["chosen"].get(d["day"], []))
    print(f"  {d['day']}: {len(ch & own.get(d['day'], set()))} of {len(ch)} also the path's ({len(own.get(d['day'], set()))}); rewards {d['rew']:.2f} against {paper.get(d['day'], float('nan')):.2f}")

print("\n=== the bar ===")
if void:
    print("VOID:", "; ".join(void))
fig = lambda arm, R: [d["tot"] - (1 - R) * d["rew"] for d in A[arm]["days"]]
ok_all = not void
for fill in ("strict", "at-price"):
    a, b = f"RESEL6 | {fill}", f"L1 | {fill}"
    assert [d["day"] for d in A[a]["days"]] == [d["day"] for d in A[b]["days"]]
    D = [x - y for x, y in zip(fig(a, 0.4), fig(b, 0.4))]
    rng = random.Random(20261023)
    s = sorted(sum(rng.choice(D) for _ in D) for _ in range(2000))
    md = []
    for da, db in zip(A[a]["days"], A[b]["days"]):
        for c in set(da["market"]) | set(db["market"]):
            x, y = da["market"].get(c, {"tot": 0, "rew": 0}), db["market"].get(c, {"tot": 0, "rew": 0})
            md.append((x["tot"] - 0.6 * x["rew"]) - (y["tot"] - 0.6 * y["rew"]))
    wo = sum(md) - max(md) if md else 0.0
    wa, wb = min(fig(a, 0.4)), min(fig(b, 0.4))
    c1, c2, c3 = s[100] > 0, wo > 0, wa >= wb - 1e-9
    ok_all = ok_all and c1 and c2 and c3
    print(f"{fill:8}: sum D {sum(D):+.2f}; 1 bootstrap index 100 {s[100]:+.2f} {'ok' if c1 else 'FAIL'}; 2 market-days less the best {wo:+.2f} {'ok' if c2 else 'FAIL'}; 3 worst day {wa:.2f} against L1's {wb:.2f} {'ok' if c3 else 'FAIL'}; days ahead {sum(1 for x in D if x > 0)}/{len(D)}")
    for R in (1.0, 0.2):
        print(f"          beside, R = {R}: sum D {sum(x - y for x, y in zip(fig(a, R), fig(b, R))):+.2f}; RESEL6 {sum(fig(a, R)):.2f}, L1 {sum(fig(b, R)):.2f}")
    print(f"          totals at R = 0.4: RESEL6 {sum(fig(a, 0.4)):.2f}, L1 {sum(fig(b, 0.4)):.2f}")
for fill in ("strict", "at-price"):
    p, q = f"RESEL6 passive | {fill}", f"L1 passive | {fill}"
    print(f"reported, passive exit model, {fill}: RESEL6 {sum(fig(p, 0.4)):.2f}, L1 {sum(fig(q, 0.4)):.2f} at R = 0.4")
print(f"\nRESEL6: {'VOID' if void else ('PASS' if ok_all else 'FAIL')}")
