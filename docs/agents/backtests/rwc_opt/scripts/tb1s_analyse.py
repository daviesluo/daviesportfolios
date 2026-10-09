# TB1-SELLS (2026-10-09): L1 (S2 + TB1's skip) against L1 with TB1's skip-buys, from scripts/tb1s_run.ts's four files.
# python3 -I scripts/tb1s_analyse.py  (from this folder; reads ../lpself/results too)
# First the copy's check: its L1 / L0 / C2 day series equal RWC-OPT's and LPSELF's committed ones exactly. Then, per
# record, fill model and R: totals, D_i = skip-buys' day less L1's at R (total less (1 - R) of the rewards), the days
# ahead / behind / equal, each arm's worst day, and the paired day bootstrap as RWC-OPT's bar.py and Addendum 2 read it
# (a fresh random.Random(20261023), 2,000 draws of len(D) choices, the sums sorted, index 100), with the share of draws > 0.
import gzip, json, random
def load(f):
    try: return json.load(open(f))
    except FileNotFoundError: return json.load(gzip.open(f + '.gz'))
T = {k: load(f'results/tb1s_{k}.json') for k in ('rw', 'rw_atprice', 'pr', 'pr_atprice')}
LP = {k: load(f'../lpself/results/lp_{k}.json') for k in ('rw', 'rw_atprice', 'pr', 'pr_atprice')}
RA = load('results/rw_arms.json')['arms']

print('== the copy reproduces the frozen simulators (day changes in total, rewards and stress, exact float equality)')
def same(a, b): return len(a) == len(b) and all(x['day'] == y['day'] and x['tot'] == y['tot'] and x['rew'] == y['rew'] and x['str'] == y['str'] for x, y in zip(a, b))
ok_all = True
for k in T:
    for arm in ('L1', 'L0 (no TB1)'):
        ok = same(T[k][arm]['daily'], LP[k][arm]['daily']); ok_all &= ok
        print(f"  {k:11} {arm:24} vs LPSELF lp_{k}.json: {'identical' if ok else 'DIFFERENT'}")
for k, fill in (('rw', 'strict'), ('rw_atprice', 'at-price')):
    for mine, theirs in (('L1', 'C1 S2+tb1-skip'), ('L0 (no TB1)', 'S2'), ('L1 exitCarried', 'C2 C1 exitCarried')):
        ok = same(T[k][mine]['daily'], RA[f'{theirs} | {fill}']['days']); ok_all &= ok
        print(f"  {k:11} {mine:24} vs RWC-OPT rw_arms '{theirs} | {fill}': {'identical' if ok else 'DIFFERENT'}")
print(f"  all identical: {ok_all}")

def fig(rec, arm, R): return [d['tot'] - (1 - R) * d['rew'] for d in T[rec][arm]['daily']]
def boot(D, seed=20261023, B=2000):
    r = random.Random(seed); s = sorted(sum(r.choice(D) for _ in range(len(D))) for _ in range(B)); return s[int(0.05 * B)], sum(1 for x in s if x > 0) / B
PAIRS = [('rw', 'L1', 'L1 skip-buys', "RW's record, 14 days, carried markets by Phase A's passive model (as L1 / C1 were judged)"),
         ('rw', 'L1 exitCarried', 'L1 skip-buys exitCarried', "RW's record, carried markets by close-only quotes (RWC-OPT's C2; the record holds a carried book only while RW quotes it)"),
         ('pr', 'L1', 'L1 skip-buys', 'full-universe record (pm-rec), 10-05 -> 10-08 22:59 UTC, close-only exits as the live path runs them')]
for rec, base, arm, title in PAIRS:
    print(f"\n== {title}")
    days = [d['day'] for d in T[rec][base]['daily']]
    print(f"   {len(days)} days {days[0]} .. {days[-1]}")
    print(f"   {'fill':8} {'R':>4} | {'L1':>9} {'skip-buys':>9} {'diff':>8} | {'ahead':>5} {'behind':>6} {'equal':>5} | {'worst L1':>8} {'worst SB':>8} | {'boot idx100':>11} {'P>0':>5} | {'h1 diff':>8} {'h2 diff':>8}")
    for fill in ('strict', 'at-price'):
        k = rec if fill == 'strict' else rec + '_atprice'
        for R in (0.2, 0.4, 1.0):
            a, b = fig(k, arm, R), fig(k, base, R)
            D = [x - y for x, y in zip(a, b)]
            p5, pos = boot(D)
            h = len(D) // 2
            print(f"   {fill:8} {R:4.1f} | {sum(b):9.2f} {sum(a):9.2f} {sum(D):+8.2f} | {sum(1 for x in D if x > 1e-9):5d} {sum(1 for x in D if x < -1e-9):6d} {sum(1 for x in D if abs(x) <= 1e-9):5d} | {min(b):8.2f} {min(a):8.2f} | {p5:+11.2f} {pos:5.2f} | {sum(D[:h]):+8.2f} {sum(D[h:]):+8.2f}")
    print(f"   per day at R = 0.40 (skip-buys less L1), strict | at-price:")
    Ds = [x - y for x, y in zip(fig(rec, arm, .4), fig(rec, base, .4))]
    Da = [x - y for x, y in zip(fig(rec + '_atprice', arm, .4), fig(rec + '_atprice', base, .4))]
    print('   ' + '  '.join(f"{d[5:]} {x:+.2f}|{y:+.2f}" for d, x, y in zip(days, Ds, Da)))
    print(f"   {'fill':8} {'arm':26} {'fills':>6} {'rewards':>8} {'fills P&L':>9} {'stress':>8} | {'held $ mean':>11} {'max':>7} | {'tight min':>9} {'any held':>8} {'sellable':>8} | {'tight sell fills':>16} {'shares':>8}")
    for fill in ('strict', 'at-price'):
        k = rec if fill == 'strict' else rec + '_atprice'
        for x in (base, arm):
            o = T[k][x]; e, i = o['end'], o['inv']
            print(f"   {fill:8} {x:26} {o['fills']:6d} {e['reward']:8.2f} {e['fillsPnl']:9.2f} {e['stress']:8.2f} | {i['heldMean']:11.2f} {i['heldMax']:7.2f} | {i['tightMin']:9d} {i['tightAnyHeldMin']:8d} {i['tightSellableMin']:8d} | {i['tightSellFills']:16d} {i['tightSellShares']:8.1f}")

print("\n== the direct effect: mark-outs of the resting fills in the simulation (cents a share in our favour, the record's mid")
print("   15 / 60 minutes later or the payout; $ = the shares marked x the 60-minute mark-out)")
print(f"   {'record':11} {'arm':26} {'fills of':20} {'n':>5} {'shares':>7} {'mo15 c':>7} {'mo60 c':>7} {'mo60 $':>8}")
for rec in ('rw', 'rw_atprice', 'pr', 'pr_atprice'):
    for x in T[rec]:
        if 'skip-buys' not in x and x not in ('L1', 'L1 exitCarried'): continue
        for g in ('sell, tight minute', 'sell, other minute', 'buy, other minute'):
            a = T[rec][x]['markouts'].get(g)
            if a: print(f"   {rec:11} {x:26} {g:20} {a['n']:5d} {a['shares']:7.0f} {a['mo15']:7.2f} {a['mo60']:7.2f} {a['w60'] * a['mo60'] / 100:8.2f}")
