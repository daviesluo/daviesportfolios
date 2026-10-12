"""LP-SPEED: what a faster loop would cost in POSTs, and how fast Polymarket's reward reads show a change.

Usage (repository root):
  python3 -I docs/agents/backtests/lpspeed/scripts/speed_costs.py docs/agents/backtests/lpspeed/data/selection.csv \
      <prints dir> <poll.jsonl> > docs/agents/backtests/lpspeed/results/speed_costs.txt

1. Re-decisions a faster loop would make. For every market of live-prep's selection (data/selection.csv, from its
   selection or refill time to the end of its UTC day; 2026-10-09 01:33 to 2026-10-12 07:30 UTC), the k-second buckets
   holding at least one print (pm-rec's tape). A loop that re-reads and reprices when the book trades re-decides at most
   once per such bucket per market; with both sides resting that is up to two POSTs (and two cancels). Upper bound: a
   print does not always move our rule's price, and a market is not always quoted on both sides.
2. The reward reads (scripts/poll_programmes.py's record): per market and read, every change of the programme as the
   check uses it (native rate in force today, maximum spread, minimum size), when each read first showed it, and the
   cache each answered from.
"""
import csv
import glob
import gzip
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

sel_path, prints_dir, poll_path = sys.argv[1], sys.argv[2], sys.argv[3]
T0 = datetime(2026, 10, 9, 1, 33, tzinfo=timezone.utc).timestamp()
T1 = datetime(2026, 10, 12, 7, 30, tzinfo=timezone.utc).timestamp()

win = defaultdict(list)
for r in csv.DictReader(open(sel_path)):
    d = datetime.strptime(r["day"] + " " + r["selected_at"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc).timestamp()
    end = datetime.strptime(r["day"], "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() + 86400
    win[r["rec_id"]].append((max(d, T0), min(end, T1)))

prints = defaultdict(list)
for p in sorted(glob.glob(os.path.join(prints_dir, "prints_*.jsonl.gz"))):
    with gzip.open(p, "rt") as fh:
        for line in fh:
            x = json.loads(line)
            if isinstance(x, list) and str(x[0]) in win:
                t = x[1] - 3   # the tape's stamp runs ~3 s behind the match (tape.py)
                if any(a <= t < b for a, b in win[str(x[0])]):
                    prints[str(x[0])].append(t)

days = (T1 - T0) / 86400
print("## 1. re-decisions a print-driven loop would make, live-prep's selected markets, 2026-10-09 01:33 to 10-12 07:30 UTC")
n_prints = sum(len(v) for v in prints.values())
print(f"markets {len(win)}, with prints {sum(1 for v in prints.values() if v)}; prints {n_prints} ({n_prints / days:.0f} a day)")
print("k s | (market, k-s bucket) with a print, a day | upper bound on extra POSTs a day (two sides)")
for k in (1, 2, 5, 10, 15, 30, 60):
    b = sum(len({int(t // k) for t in v}) for v in prints.values())
    print(f"{k} | {b / days:.0f} | {2 * b / days:.0f}")
print()

print("## 2. how fast the reward reads show a programme change (live poll, keyless)")
recs = [json.loads(l) for l in open(poll_path)]
t_lo, t_hi = min(r["t"] for r in recs), max(r["t"] for r in recs)
print(f"poll: {len(recs)} answers over {(t_hi - t_lo) / 60:.1f} minutes, from {datetime.fromtimestamp(t_lo, timezone.utc):%Y-%m-%d %H:%M:%S} UTC")
for read in ("clob", "clob_bust", "sponsored", "gamma"):
    rs = [r for r in recs if r["read"] == read]
    if not rs:
        continue
    st = Counter(r.get("status") for r in rs)
    cf = Counter(r.get("cf") for r in rs)
    cc = Counter(r.get("cc") for r in rs)
    dts = sorted(r["dt"] for r in rs if r.get("dt") is not None)
    lat = f", latency p50 {dts[len(dts) // 2]:.3f} s p90 {dts[len(dts) * 9 // 10]:.3f} s" if dts else ""
    print(f"{read}: {len(rs)} answers; status {dict(st)}; cache-control {dict(cc)}; cf-cache-status {dict(cf)}{lat}")


def key(r):
    return (r.get("listed"), r.get("native"), r.get("v"), r.get("min"))


print()
print("changes seen per market (read: first time each new value was seen, seconds after the poll began)")
first = {}
for read in ("clob", "clob_bust"):
    by = defaultdict(list)
    for r in recs:
        if r["read"] == read and r.get("status") == 200 and "native" in r or (r["read"] == read and r.get("listed") is False):
            by[r["cond"]].append(r)
    for cond, rs in sorted(by.items()):
        rs.sort(key=lambda r: r["t"])
        prev, ch = None, []
        for r in rs:
            if key(r) != prev:
                if prev is not None:
                    ch.append((round(r["t"] - t_lo, 1), key(r)))
                prev = key(r)
        first[(read, cond)] = ch
conds = sorted({c for _, c in first})
total = {"clob": 0, "clob_bust": 0}
for c in conds:
    a, b = first.get(("clob", c), []), first.get(("clob_bust", c), [])
    total["clob"] += len(a)
    total["clob_bust"] += len(b)
    vals = Counter(key(r) for r in recs if r["read"] == "clob_bust" and r.get("cond") == c and r.get("status") == 200)
    print(f"{c}: cached read {len(a)} changes, origin read {len(b)} changes; origin values seen: "
          + "; ".join(f"{v} x{n}" for v, n in vals.most_common()))
    for (ta, va) in a[:6]:
        tb = max((t for t, v in b if v == va and t <= ta), default=None)
        print(f"   {va}: cached at +{ta} s, origin last turned to it at +{tb} s, cache behind by {None if tb is None else round(ta - tb, 1)} s")
print(f"changes in all: cached {total['clob']}, origin {total['clob_bust']}, over {len(conds)} markets and {(t_hi - t_lo) / 60:.1f} minutes")
print()
print("transitions at the origin: from the first answer of the new programme to the last answer of the old one")
for c in conds:
    b = first.get(("clob_bust", c), [])
    a = first.get(("clob", c), [])
    if len(b) < 2:
        continue
    vals = Counter(key(r) for r in recs if r["read"] == "clob_bust" and r.get("cond") == c and r.get("status") == 200)
    print(f"{c}: {len(b)} flips at the origin between +{b[0][0]} s and +{b[-1][0]} s ({b[-1][0] - b[0][0]:.0f} s); "
          f"the cached read flipped {len(a)} times, first at +{a[0][0] if a else None} s, last at +{a[-1][0] if a else None} s; "
          f"it settled on {b[-1][1]}")
gs = sorted((r for r in recs if r["read"] == "gamma" and r.get("ours")), key=lambda r: r["t"])
gch = 0
for i in range(1, len(gs)):
    for c in gs[i]["ours"]:
        if gs[i]["ours"].get(c) != gs[i - 1]["ours"].get(c):
            gch += 1
print(f"gamma: {len(gs)} reads, {gch} market-changes of clobRewards between consecutive reads")
