"""DEADLINE-NO: the robustness read AFTER the frozen 2024 verdict (reported apart; it changes nothing in the verdict).

Same universe, prices and trade as `deadline_no.py` (imported from it), on every market of 2024, 2025 and 2026 (no
sample), and pooled:
  1. the entry day: T - 5, 6, 7, 8, 9, 10 and 14 days, YES in [0.20, 0.50);
  2. the band at T - 7: [0.15, 0.20), [0.20, 0.50), [0.50, 0.60);
  3. the category (deadline_no.py's keyword classes) at the frozen rule;
  4. realistic fills at the frozen rule: the price takers actually paid for NO on the public tape 6 h either side of the
     entry (median, and the 75th percentile as a worse fill), today's taker rate by category; trades with no NO taker
     nearby counted apart;
  5. clustering: how often an event's trades win or lose together, the within-event correlation of losses, and the
     effective number of independent bets it leaves.
Every cell: trades, events, mean return per $1, the event bootstrap's 5th and 95th percentiles (2,000 draws, seed
20261013). 7 + 3 + 6 + 2 cells a year are read; none is a test.

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/deadline_robust.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pmnet  # noqa: E402
from deadline_no import HALF, boot, category, fee_rate, no_ret, price_at, ts, universe  # noqa: E402

YEARS = (2024, 2025, 2026)
data = {}
for y in YEARS:
    mk = universe(y, False)
    cache = json.load(open(os.path.join(pmnet.DATA, f"dno_raw_{y}.json")))
    tape_p = os.path.join(pmnet.DATA, f"dno_tape_{y}.json")
    tape = json.load(open(tape_p)) if os.path.exists(tape_p) else {}
    data[y] = (mk, cache, tape)


def trades(y, d, lo, hi):
    mk, cache, _ = data[y]
    out = []
    for m in mk:
        end = ts(m["endDate"]); px = price_at(cache.get(m["conditionId"]) or [], end, d)
        if px is None or not (lo <= px < hi): continue
        v = no_ret(px, m["_pay"], fee_rate(m))
        if v is None: continue
        ev = (m.get("events") or [{}])[0].get("slug") or m["conditionId"]
        out.append({"y": px, "ret": v, "ev": f"{y}:{ev}", "pay": m["_pay"], "cat": category(m.get("question"))[0],
                    "today": category(m.get("question"))[1], "cond": m["conditionId"], "t": end - d * 86400, "year": y})
    return out


def cell(lab, ts_):
    if len(ts_) < 5:
        print(f"  {lab:<34} {len(ts_):>5} trades"); return
    lo, hi, nev = boot([(t["ret"], t["ev"]) for t in ts_])
    m = sum(t["ret"] for t in ts_) / len(ts_)
    print(f"  {lab:<34} {len(ts_):>5} trades {nev:>5} events  {m:+.4f} [{lo:+.4f}, {hi:+.4f}]  won {100 * sum(1 for t in ts_ if t['pay'] == 0.0) / len(ts_):5.1f} %")


print("DEADLINE-NO robustness (after the frozen 2024 verdict; description only). Return per $1 [event bootstrap 5-95 %].")
print("\n== 1. the entry day, YES in [0.20, 0.50)")
for d in (5, 6, 7, 8, 9, 10, 14):
    pooled = []
    for y in YEARS:
        x = trades(y, d, 0.20, 0.50); pooled += x; cell(f"T - {d:>2} d, {y}", x)
    cell(f"T - {d:>2} d, pooled", pooled)
print("\n== 2. the band at T - 7 d")
for lo, hi in ((0.15, 0.20), (0.20, 0.50), (0.50, 0.60)):
    pooled = []
    for y in YEARS:
        x = trades(y, 7, lo, hi); pooled += x; cell(f"[{lo:.2f}, {hi:.2f}) {y}", x)
    cell(f"[{lo:.2f}, {hi:.2f}) pooled", pooled)
main = [t for y in YEARS for t in trades(y, 7, 0.20, 0.50)]
print("\n== 3. by category, the frozen rule, pooled 2024-2026")
for c in sorted({t["cat"] for t in main}):
    cell(c, [t for t in main if t["cat"] == c])

print("\n== 4. realistic fills, the frozen rule: the tape's price for NO 6 h either side of the entry, today's taker rate")
real_med, real_p75, none = [], [], 0
for t in main:
    tape = data[t["year"]][2].get(t["cond"]) or []
    got = []
    for x in tape:
        if not (t["t"] - 6 * 3600 <= x.get("timestamp", 0) <= t["t"] + 6 * 3600): continue
        o, s, p, z = x.get("outcome"), x.get("side"), float(x.get("price") or 0), float(x.get("size") or 0)
        if o == "No" and s == "BUY": got.append(p)
        elif o == "Yes" and s == "SELL": got.append(1 - p)
    if not got:
        none += 1; continue
    got.sort()
    for q, out in ((got[len(got) // 2], real_med), (got[min(len(got) - 1, 3 * len(got) // 4)], real_p75)):
        if not (0 < q < 1): continue
        cost = q + t["today"] * q * (1 - q)
        out.append(dict(t, ret=(1 - t["pay"]) / cost - 1))
cell("as frozen (1 - YES + 1 c, own fee)", main)
cell("tape median + today's fee", real_med)
cell("tape 75th pct + today's fee", real_p75)
print(f"  trades with no NO taker within 6 h: {none} of {len(main)} (left out of the two tape rows)")

print("\n== 5. clustering, the frozen rule pooled")
by = {}
for t in main: by.setdefault(t["ev"], []).append(t)
multi = {e: v for e, v in by.items() if len(v) >= 2}
same = sum(1 for v in multi.values() if len({t["pay"] for t in v}) == 1)
print(f"  {len(main)} trades in {len(by)} events; {len(multi)} events hold 2+ trades ({sum(len(v) for v in multi.values())} trades); "
      f"in {same} of them every trade won or every trade lost")
loss = [1.0 if t["pay"] == 1.0 else 0.0 for t in main]
p = sum(loss) / len(loss)
num = den = 0.0
for v in multi.values():
    ls = [1.0 if t["pay"] == 1.0 else 0.0 for t in v]
    for i in range(len(ls)):
        for j in range(len(ls)):
            if i != j: num += (ls[i] - p) * (ls[j] - p); den += 1
rho = (num / den) / (p * (1 - p)) if den and 0 < p < 1 else float("nan")
mbar = sum(len(v) ** 2 for v in by.values()) / len(main)
neff = len(main) / (1 + (mbar - 1) * rho) if rho == rho else float("nan")
print(f"  loss rate {100 * p:.1f} %; within-event correlation of losses {rho:.3f}; size-weighted trades an event {mbar:.2f}; "
      f"effective independent bets {neff:.0f} of {len(main)}")
worst = sorted(by.items(), key=lambda kv: sum(t["ret"] for t in kv[1]))[:5]
print("  the five events that lost most: " + "; ".join(f"{e[:60]} {sum(t['ret'] for t in v):+.2f} ({len(v)} trades)" for e, v in worst))
