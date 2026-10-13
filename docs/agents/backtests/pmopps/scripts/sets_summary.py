"""PMOPPS: what sets_scan.py found, as episodes a minute loop could take.

An episode is a run of consecutive recorded minutes (gaps of up to 2 minutes allowed) with an edge after fees on the same
event, side (or ladder pair). A loop that reads once a minute takes it at its SECOND minute (it must see it, then act),
for what that minute's books held; one that acts within the minute takes the first. Each is valued at the walked
profit; the capital is the cost of the sets, locked until the event's last scheduled end (Gamma's endDate).

usage: PM_DATA=<scratch> python3 -I docs/agents/backtests/pmopps/scripts/sets_summary.py <events.json>
"""
import json
import os
import sys
from collections import defaultdict
from datetime import datetime

D = os.environ.get("PM_DATA", ".")
scan = json.load(open(os.path.join(D, "sets_scan.json")))
events = json.load(open(sys.argv[1]))
DAYS = scan["minutes"] / 1440        # the recorded minutes, as days


def end_of(slug):
    ends = [m.get("endDate") for m in events[slug]["markets"] if m.get("endDate")]
    if not ends: return None
    return datetime.fromisoformat(max(ends).replace("Z", "+00:00")).timestamp()


comp = defaultdict(int)
for kind, slug, n in scan["complete"]:
    comp[kind] += n
print(f"neg-risk sets complete in the books (every market recorded): {scan['sets']} events, {comp['set']:,} event-minutes; "
      f"date ladders: {scan['ladders']} events, {comp['ladder']:,} event-minutes; over {scan['minutes']:,} recorded minutes")
groups = defaultdict(list)
for kind, slug, side, minute, n, gross, first, sets, profit in scan["hits"]:
    groups[(kind, slug, side)].append((minute, gross, first, sets, profit, n))
for kind in ("set", "ladder"):
    eps = []
    for (k, slug, side), xs in groups.items():
        if k != kind: continue
        xs.sort()
        run = [xs[0]]
        for x in xs[1:]:
            if x[0] - run[-1][0] <= 180: run.append(x)
            else: eps.append((slug, side, run)); run = [x]
        eps.append((slug, side, run))
    gross_eps = len(eps)
    net = [(s, side, r) for s, side, r in eps if any(x[4] > 0 for x in r)]
    print(f"\n== {kind}: {gross_eps} episodes with a gross edge (any size), {len(net)} with an edge after taker fees")
    take0 = take1 = cap0 = cap1 = 0.0; dur = []; rows = []
    for slug, side, r in net:
        pos = [x for x in r if x[4] > 0]
        dur.append(len(pos))
        p0 = pos[0][4]; p1 = pos[1][4] if len(pos) > 1 else 0.0
        take0 += p0; take1 += p1
        e = end_of(slug); lock = (e - pos[0][0]) / 86400 if e else None
        rows.append((p0, p1, slug, side, len(pos), pos[0][2], pos[0][3], lock, pos[0][5]))
    dur.sort()
    if dur:
        print(f"minutes an after-fee edge lasted: median {dur[len(dur) // 2]}, p90 {dur[9 * len(dur) // 10]}, max {dur[-1]}; "
              f"episodes lasting 2+ minutes: {sum(1 for d in dur if d >= 2)}")
    print(f"taken in its first minute: ${take0:.2f} over the record (${take0 / DAYS:.2f} a day); at its second (a loop a minute): ${take1:.2f} (${take1 / DAYS:.2f} a day)")
    small = sum(min(p0, 0.0 + p0 * min(1.0, 1000.0 / max(1e-9, sets))) for p0, p1, slug, side, d, fe, sets, lock, n in rows)
    print(f"the same, with at most $1,000 of sets an episode: ${small:.2f} over the record (${small / DAYS:.2f} a day)")
    for p0, p1, slug, side, d, fe, sets, lock, n in sorted(rows, reverse=True)[:12]:
        print(f"  {slug[:60]:<60} {side:<6} legs {n:>2} first-set edge {fe:>6.2f} c, {sets:>8.1f} sets, ${p0:>7.2f} (2nd min ${p1:>6.2f}), "
              f"{d:>3} min, locked {lock if lock is None else round(lock, 1)} days")
