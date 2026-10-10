# LP-ALLOC: live-prep's 10-09 fills (data/lp_live_1009.json) marked at each market's adjusted mid at 23:59 UTC as the full-universe
# record holds it (YES at m, NO at 1 - m), beside the count and shares; the fills' P&L of the day, to set against the
# simulator's on the same markets (results/calib.txt). python3 -I scripts/live_fills.py <pr_record.json>
import json, sys
from collections import defaultdict
live = json.load(open('data/lp_live_1009.json'))
o = json.load(open(sys.argv[1]))
conds = o['conds']; last = {}
end = (o['last'] // 60000)
for r in o['rows']:
    if r[0] > end: continue
    c = conds[r[1]]
    if r[5] == r[5] and r[6] == r[6] and r[5] is not None and r[6] is not None: last[c] = (r[0], (r[5] + r[6]) / 2)
pos = defaultdict(lambda: {'yes': [0.0, 0.0], 'no': [0.0, 0.0]})
n = defaultdict(lambda: [0, 0.0])
for f in live['fills']:
    p = pos[f['cond']][f['outcome']]; q, px = float(f['size']), float(f['price'])
    p[0] += q if f['side'] == 'BUY' else -q; p[1] += -q * px if f['side'] == 'BUY' else q * px
    n[f['cond']][0] += 1; n[f['cond']][1] += q
tot = 0; tot9 = 0
for c, p in sorted(pos.items()):
    m = last.get(c)
    if not m: print(c[:10], 'no mark in the record', n[c]); continue
    v = p['yes'][1] + p['no'][1] + p['yes'][0] * m[1] + p['no'][0] * (1 - m[1])
    tot += v
    print(f"{c[:10]} fills {n[c][0]:3d} shares {n[c][1]:6.0f}  YES {p['yes'][0]:7.1f} NO {p['no'][0]:7.1f}  mark {m[1]:.3f}  P&L {v:7.2f}")
print(f"total over marked markets: {tot:.2f}; fills {sum(x[0] for x in n.values())}, shares {sum(x[1] for x in n.values()):.0f}")
