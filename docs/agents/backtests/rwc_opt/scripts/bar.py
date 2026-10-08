# RWC-OPT's bar (reviews/2026-10-09-rwc-optimised-arms-prereg.md), on results/<run>_arms.json from scripts/run.ts.
# python3 -I scripts/bar.py results/rwc_arms.json   (results/rw_arms.json: the same code on RW's record, in sample)
# For each test (C1 against S2, C3 against x1) and each fill model: D_i = the arm's day figure at R = 0.40 (total less 0.6
# of its rewards) less the base's on the same day; a fresh random.Random(20261023), 2,000 draws of len(D) choices, the
# sums sorted, the one at index 100 > 0; and over every market of either arm and every day, d_{c,i} = the arm's
# market-day change at R = 0.40 less the base's, whose sum less its largest one > 0. A test passes if all four hold.
# Beside it, never part of it: the same at R = 1 and R = 0.2, the totals, and C2's arms.
import json, random, sys
o = json.load(open(sys.argv[1]))
A = o['arms']
def day_fig(a, R): return [d['tot'] - (1 - R) * d['rew'] for d in A[a]['days']]
def boot(D, seed=20261023, B=2000):
    r = random.Random(seed); s = sorted(sum(r.choice(D) for _ in range(len(D))) for _ in range(B)); return s[int(0.05 * B)]
def market_days(a, b, R):
    da, db = A[a]['days'], A[b]['days']
    out = []
    for i in range(len(da)):
        ma, mb = da[i]['market'], db[i]['market']
        for c in set(ma) | set(mb):
            fa = ma.get(c, {'tot': 0, 'rew': 0}); fb = mb.get(c, {'tot': 0, 'rew': 0})
            out.append((fa['tot'] - (1 - R) * fa['rew']) - (fb['tot'] - (1 - R) * fb['rew']))
    return out
TESTS = [('C1', 'C1 S2+tb1-skip', 'S2'), ('C3', 'C3 x1+pause+tb1-skip', 'x1')]
print(f"run {o['run']}, {o['from']} -> {o['last']}, {len(o['days'])} days: {', '.join(o['days'])}")
for name, arm, base in TESTS:
    ok = True
    for fill in ('strict', 'at-price'):
        a, b = f'{arm} | {fill}', f'{base} | {fill}'
        assert [d['day'] for d in A[a]['days']] == [d['day'] for d in A[b]['days']]
        D = [x - y for x, y in zip(day_fig(a, 0.4), day_fig(b, 0.4))]
        p5 = boot(D)
        md = market_days(a, b, 0.4)
        wo = sum(md) - max(md) if md else 0.0
        ok = ok and p5 > 0 and wo > 0
        print(f"{name} {fill:8}: sum D {sum(D):9.2f}  bootstrap index 100 {p5:9.2f} {'>0' if p5 > 0 else '<=0'}  market-days {len(md)}, sum less best {wo:9.2f} {'>0' if wo > 0 else '<=0'}  days arm>base {sum(1 for x in D if x > 0)}/{len(D)}")
        for R in (1.0, 0.2):
            D2 = [x - y for x, y in zip(day_fig(a, R), day_fig(b, R))]
            md2 = market_days(a, b, R)
            print(f"      beside, R={R}: sum D {sum(D2):9.2f}  bootstrap index 100 {boot(D2):9.2f}  market-days less best {sum(md2) - max(md2) if md2 else 0:9.2f}")
        for x in (a, b):
            e = A[x]['end']
            print(f"      {x:38} R=1 {e['total']:9.2f}  R=0.4 {e['total'] - 0.6 * e['reward']:9.2f}  R=0.2 {e['total'] - 0.8 * e['reward']:9.2f}  stress {e['stress']:9.2f}  rewards {e['reward']:9.2f}  fills {A[x]['fills']}  worst day R=0.4 {min(day_fig(x, 0.4)):8.2f}")
    print(f"{name}: {'PASS' if ok else 'FAIL'} (all four conditions)\n")
print("C2, reported only:")
for fill in ('strict', 'at-price'):
    for x in (f'C2 S2 exitCarried | {fill}', f'C2 C1 exitCarried | {fill}', f'S2 | {fill}', f'C1 S2+tb1-skip | {fill}'):
        e = A[x]['end']
        print(f"  {x:38} R=1 {e['total']:9.2f}  R=0.4 {e['total'] - 0.6 * e['reward']:9.2f}  R=0.2 {e['total'] - 0.8 * e['reward']:9.2f}  stress {e['stress']:9.2f}")
