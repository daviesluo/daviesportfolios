"""RW's verdict, step b's second implementation (RW-NEXT Part 1.1: "rw_test.py's run_market, a separate implementation,
is run beside it on the same minutes and prints, and its fills and rewards are reported against the record, market by
market. They decide nothing."). Each market's quoted minutes in order, with RW's stored rows and prints, through
backtests/polymarket/scripts/rw_test.py's run_market under the market's first selection's programme; its fills and
rewards against pm_rw_fills and the rewards the engine stored in pm_rw_minutes.

usage: python3 -I scripts/rwtest_beside.py > results/rwtest_beside.txt
"""
import gzip
import json
import os
import sys
from collections import defaultdict
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "polymarket", "scripts"))
from rw_test import run_market  # noqa: E402


def load(path):
    if os.path.exists(path):
        return json.load(open(path))
    with gzip.open(path + ".gz", "rb") as f:
        return json.loads(f.read())


ts = lambda s: datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
num = lambda s: None if s == "" else float(s)
START, END = ts("2026-09-25T00:00:00Z"), ts("2026-10-09T00:00:00Z")
files = [f"../pmlp/data/min_2026-09-{d:02d}.json" for d in range(25, 31)] + [f"../pmlp/data/min_2026-10-{d:02d}.json" for d in range(1, 4)]
files += [f"../rwc_opt/data/rw_min_2026-10-{d:02d}.json" for d in range(4, 8)] + ["data/rw_min_2026-10-08.json"]
series = defaultdict(dict)
rec_reward = defaultdict(float)
for f in files:
    p = load(f)
    for line in p["data"].split(";"):
        ci, m0, cnt, rest = line.split(",", 3)
        x = rest.split("|")
        if x[0] != "1":
            continue
        cond = p["conds"][int(ci)]
        for k in range(int(cnt)):
            t = (int(m0) + k) * 60
            if not (START <= t < END):
                continue
            bb, ba = num(x[2]), num(x[3])
            row = None if bb is None or ba is None else (bb, ba, num(x[4]), num(x[5]), float(x[6] or 0), float(x[7] or 0))
            series[cond][t] = (row, float(x[1]) or 0.01)
            if x[11] != "":
                rec_reward[cond] += float(x[11])
rec = load("data/rw_record.json")
sel = {}
for s in sorted(rec["selection"], key=lambda s: (s["day"], s["rank"])):
    sel.setdefault(s["cond"], s)
prints = defaultdict(list)
for p in rec["prints"]:
    prints[p["cond"]].append((ts(p["ts"]), p["side"], int(p["oi"]), float(p["price"]), float(p["size"])))
rec_fills = defaultdict(int)
for f in rec["fills"]:
    if ts(f["minute"]) >= START:
        rec_fills[f["cond"]] += 1
same_f = same_r = n = 0
diff = []
for cond in sorted(series):
    s = sel.get(cond)
    if not s:
        continue
    mins = sorted(series[cond])
    mk = {"v": float(s["v"]), "rate": float(s["rate"]), "tick": series[cond][mins[0]][1], "min_size": float(s["min_size"]),
          "prints": sorted(prints[cond]), "series": [(t, series[cond][t][0]) for t in mins], "status": {}}
    r = run_market(mk, END)
    n += 1
    f_ok = r["fills"] == rec_fills[cond]
    r_ok = abs(r["reward"] - rec_reward[cond]) < 0.01
    same_f += f_ok
    same_r += r_ok
    if not (f_ok and r_ok):
        diff.append(f"{cond[:12]} {s['q'][:50]!r}: run_market fills {r['fills']} rewards {r['reward']:.4f} | record fills {rec_fills[cond]} rewards {rec_reward[cond]:.4f}")
print(f"run_market beside stepRw, {n} quoted markets: fills equal to pm_rw_fills in {same_f}, rewards within $0.01 of pm_rw_minutes' in {same_r}")
print("markets where they differ (run_market quotes each market under its first selection's programme and holds its 3N across days; it decides nothing):")
for line in diff:
    print("  " + line)
