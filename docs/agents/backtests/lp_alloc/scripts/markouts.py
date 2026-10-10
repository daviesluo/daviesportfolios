# LP-ALLOC: adverse selection by market type (results/markouts.txt) from sql/markouts.sql's reply (data/markouts.json).
# python3 -I scripts/markouts.py > results/markouts.txt
# Per path and type: fills, shares, the fills' markout at 5 / 30 / 120 minutes ($ and cents a share, over the fills whose
# path recorded a mid that much later), the formula reward the path's minutes credited the same types' markets, and the
# net at 120 minutes with that reward at R = 0.4 and 0.9 (R against the path's own formula: 10-09's live readout,
# results/calib.txt). Then the markets whose fills lost most at 120 minutes, the concentration the -$75 stop meets.
import json
from collections import defaultdict
o = json.load(open('data/markouts.json'))
rows, rbt = o['rows'], o['rewardByType']
agg = defaultdict(lambda: defaultdict(float))
for r in rows:
    a = agg[(r['p'], r['t'])]
    for k in ['n', 'sh', 'mo5', 'sh5', 'mo30', 'sh30', 'mo120', 'sh120']: a[k] += float(r[k] or 0)
    a['mk'] += 1
rew = defaultdict(float); nmk = defaultdict(int)
for r in rbt: rew[(r['p'], r['t'])] += float(r['reward']); nmk[(r['p'], r['t'])] += 1
types = sorted({t for _, t in list(agg) + list(rew)})
print("Markouts by market type: $ (cents a share) at 5 / 30 / 120 minutes after the fill, at the path's own recorded mid. Negative = adverse.")
print("form$: the formula the path's minutes credited all its markets of that type (RW / RW-C at the programme of the selection, so an upper bound);")
print("net120 at R: markout at 120 min + R x form$ (fills and rewards over the same record).")
for p in ['RW', 'RW-C', 'LP paper']:
    print(f"\n== {p}")
    print(f"{'type':<14}{'mkts':>5}{'fills':>7}{'shares':>9}{'mo5 $ (c/sh)':>18}{'mo30 $ (c/sh)':>18}{'mo120 $ (c/sh)':>18}{'form$':>9}{'net120 R.4':>11}{'net120 R.9':>11}")
    T = defaultdict(float)
    for t in types:
        a = agg.get((p, t)); f = rew.get((p, t), 0.0)
        if not a and not f: continue
        a = a or defaultdict(float)
        c = lambda m, s: f"{a[m]:>8.2f} ({100*a[m]/a[s] if a[s] else 0:>5.2f})"
        print(f"{t:<14}{int(a['mk']):>5}{int(a['n']):>7}{a['sh']:>9.0f}{c('mo5','sh5'):>18}{c('mo30','sh30'):>18}{c('mo120','sh120'):>18}{f:>9.2f}{a['mo120']+0.4*f:>11.2f}{a['mo120']+0.9*f:>11.2f}")
        for k in ['n', 'sh', 'mo5', 'sh5', 'mo30', 'sh30', 'mo120', 'sh120']: T[k] += a[k]
        T['f'] += f
    print(f"{'all':<14}{'':>5}{int(T['n']):>7}{T['sh']:>9.0f}{T['mo5']:>8.2f} ({100*T['mo5']/max(1,T['sh5']):>5.2f}){T['mo30']:>10.2f} ({100*T['mo30']/max(1,T['sh30']):>5.2f}){T['mo120']:>10.2f} ({100*T['mo120']/max(1,T['sh120']):>5.2f}){T['f']:>9.2f}{T['mo120']+0.4*T['f']:>11.2f}{T['mo120']+0.9*T['f']:>11.2f}")
print("\n== the 12 markets whose fills lost most at 120 minutes (all paths)")
for r in sorted(rows, key=lambda r: float(r['mo120'] or 0))[:12]:
    print(f"  {r['p']:<9}{r['cond']}  {r['t']:<13} fills {r['n']:>4} shares {float(r['sh']):>7.0f}  mo120 {float(r['mo120'] or 0):>8.2f}  formula {float(r['reward'] or 0):>7.2f}")
