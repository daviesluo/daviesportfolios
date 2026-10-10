# LP-ALLOC: how often a rewarded market's programme ends or changes inside a UTC day, from pm-rec's listing reads (the
# record's `progs`: each market every 15 minutes). python3 -I scripts/prog_stats.py <pr_record.json> > results/prog_stats.txt
# For each day 10-05 .. 10-09 and each market the record kept that paid at 00:00 (rate >= $10, N = max(min, 5) <= 20):
#   stops   its programme reads off (ended, under $10, or N over 20) for 30 minutes or more running (two readings) later that day
#   ended   no programme listed for 60 minutes or more running
#   minup   its minimum rose past 20
#   flicker a single reading off that the next reading undoes (the listing's noise; Polymarket paid the low rate where it lasted)
#   offShare the share of the day's minutes after 00:00 it read off
# for all such markets and for the ten the record's 00:00 slot ranks first (the selection's own order, N <= 20).
import json, sys
from collections import defaultdict
o = json.load(open(sys.argv[1]))
conds, progs, slots = o['conds'], o['progs'], o['slots']
idx = {c: i for i, c in enumerate(conds)}
D0 = 1791158400 // 60   # 2026-10-05 00:00 UTC in minutes
days = [D0 + 1440 * k for k in range(5)]
def state(l, mi):
    cur = None
    for e in l:
        if e[0] <= mi: cur = e
        else: break
    return cur
def on(e): return e is not None and e[1] is not None and e[1] >= 10 and e[2] and max(e[3], 5) <= 20
def day_stats(l, d0):
    e0 = state(l, d0)
    if not on(e0): return None
    # readings inside the day: entries in (d0, d0 + 1440), changes only; expand to runs between entries
    ev = [e for e in l if d0 < e[0] < d0 + 1440]
    pts = [(d0, e0)] + [(e[0], e) for e in ev] + [(d0 + 1440, None)]
    off_min, stops, ended, minup, flick = 0, False, False, False, 0
    for (t, e), (t2, _) in zip(pts[:-1], pts[1:]):
        dur = t2 - t
        if not on(e):
            off_min += dur
            if dur >= 30: stops = True
            if (e is None or e[1] is None) and dur >= 60: ended = True
            if dur < 30: flick += 1
        if e is not None and e[1] is not None and max(e[3], 5) > 20: minup = True
    return {'stops': stops, 'ended': ended, 'minup': minup, 'flicker': flick, 'off': off_min / 1440}
print("Programme changes inside the day, from pm-rec's listing reads (each market every 15 minutes).")
print(f"{'day':<12}{'set':<8}{'mkts':>6}{'stops':>8}{'ended':>8}{'minup':>8}{'flicker':>9}{'offShare':>10}")
tot = defaultdict(lambda: defaultdict(float))
for d0 in days:
    day = __import__('datetime').datetime.utcfromtimestamp(d0 * 60).strftime('%Y-%m-%d')
    slot = slots.get(f"{day}T00:00:00.000Z", [])
    top10 = [x['cond'] for x in slot if max(x['min_size'], 5) <= 20][:10]
    for name, cs in [('all', conds), ('top10', top10)]:
        rs = [r for r in (day_stats(progs[idx[c]], d0) for c in cs if c in idx) if r]
        n = len(rs)
        if not n: continue
        a = {k: sum(1 for r in rs if r[k]) for k in ['stops', 'ended', 'minup']}
        fl = sum(r['flicker'] for r in rs); off = sum(r['off'] for r in rs) / n
        print(f"{day:<12}{name:<8}{n:>6}{a['stops']:>5} {100*a['stops']/n:>2.0f}%{a['ended']:>5} {100*a['ended']/n:>2.0f}%{a['minup']:>5} {100*a['minup']/n:>2.0f}%{fl/n:>9.2f}{100*off:>9.1f}%")
        T = tot[name]; T['n'] += n; T['off'] += off * n; T['fl'] += fl
        for k in a: T[k] += a[k]
for name, T in tot.items():
    n = T['n']
    print(f"{'5 days':<12}{name:<8}{int(n):>6}{int(T['stops']):>5} {100*T['stops']/n:>2.0f}%{int(T['ended']):>5} {100*T['ended']/n:>2.0f}%{int(T['minup']):>5} {100*T['minup']/n:>2.0f}%{T['fl']/n:>9.2f}{100*T['off']/n:>9.1f}%")
