# EXPENSIVE-SIDE (2026-10-09): L1 against limits on buying a token priced >= 0.95 / 0.90, from scripts/exp_run.ts's four
# files. python3 -I scripts/exp_analyse.py  (from this folder; reads ../lpself/results and results/tb1s_* too)
# First the copy's check: its L1 day series equal LPSELF's and TB1-SELLS' committed ones exactly. Then, per record and fill
# model: where L1's rewards and fills P&L come from (by the expensive token's price) and how much it holds in tokens
# marked >= 0.90 / 0.95; then every arm at R = 0.40 and R = 1 (total less (1 - R) of the formula rewards): totals, days
# ahead / behind, worst day, the paired day bootstrap (a fresh random.Random(20261023), 2,000 draws, sums sorted, index
# 100) with the share of draws > 0, and the exposure an arm leaves: the most held at the mark in tokens marked >= 0.90 in
# all markets at once (what is lost if every one of them resolved against us in that minute) and in one market.
import gzip, json, random
def load(f):
    try: return json.load(open(f))
    except FileNotFoundError: return json.load(gzip.open(f + '.gz'))
E = {k: load(f'results/exp_{k}.json') for k in ('rw', 'rw_atprice', 'pr', 'pr_atprice')}
LP = {k: load(f'../lpself/results/lp_{k}.json') for k in ('rw', 'rw_atprice', 'pr', 'pr_atprice')}
TB = {k: load(f'results/tb1s_{k}.json') for k in ('rw', 'rw_atprice', 'pr', 'pr_atprice')}

print('== the copy reproduces the committed series (day changes in total, rewards and stress, exact float equality)')
def same(a, b): return len(a) == len(b) and all(x['day'] == y['day'] and x['tot'] == y['tot'] and x['rew'] == y['rew'] and x['str'] == y['str'] for x, y in zip(a, b))
ok_all = True
for k in E:
    for name, ref in (('LPSELF lp_', LP), ('TB1-SELLS tb1s_', TB)):
        ok = same(E[k]['L1']['daily'], ref[k]['L1']['daily']); ok_all &= ok
        print(f"  {k:11} L1 vs {name}{k}.json: {'identical' if ok else 'DIFFERENT'}")
print(f'  all identical: {ok_all}')

def fig(o, R): return [d['tot'] - (1 - R) * d['rew'] for d in o['daily']]
def boot(D, seed=20261023, B=2000):
    r = random.Random(seed); s = sorted(sum(r.choice(D) for _ in range(len(D))) for _ in range(B)); return s[int(0.05 * B)], sum(1 for x in s if x > 0) / B
TITLE = {'rw': "RW's record, 2026-09-25 -> 10-08 23:10 UTC (14 days), carried markets by Phase A's passive model (as L1 / C1 were judged)",
         'pr': "full-universe record (pm-rec), 10-05 -> 10-08 22:59 UTC (4 days), close-only exits as the live path runs them"}
B3 = ('>=.95', '.90-.95', '<.90')
for rec in ('rw', 'pr'):
    print(f'\n== {TITLE[rec]}')
    for fill, k in (('strict', rec), ('at-price', rec + '_atprice')):
        o = E[k]['L1']; x = o['expo']; rb = x['rewardBy']; rt = sum(rb.values())
        print(f"   -- L1, {fill}: where it comes from (formula rewards; fills P&L marked to each market's payout or last mid)")
        print(f"      rewards {o['end']['reward']:.2f} (attributed {rt:.2f}): " + ', '.join(f"{b} {rb[b]:.2f} ({100 * rb[b] / rt:.1f} %)" for b in B3) + "   [bucket = the minute's max(m, 1 - m)]")
        a = o['attr']; tot = sum(v['pnl'] for v in a.values())
        print(f"      fills P&L {o['end']['fillsPnl']:.2f} (attributed {tot:.2f}), by the traded token's price:")
        for b in B3:
            parts = [(kk.split(' ', 1)[1], v) for kk, v in a.items() if kk.startswith(b + ' ')]
            s = sum(v['pnl'] for _, v in parts)
            print(f"        {b:8} {s:+8.2f}  " + '  '.join(f"{kind} n {v['n']} sh {v['shares']:.0f} ${v['usd']:.0f} pnl {v['pnl']:+.2f}" for kind, v in sorted(parts)))
        hrs = x['minutes'] / 60
        print(f"      held at the mark in tokens marked >= .90: mean {x['sum90'] / x['minutes']:.2f}, max {x['max90']:.2f} (all markets), max in one market {x['maxOne90']:.2f} (at cost {x['maxOneCost90']:.2f}); >= .95: mean {x['sum95'] / x['minutes']:.2f}, max {x['max95']:.2f}, one market {x['maxOne95']:.2f}")
        h = x['hist']
        def mins(lo, b=None): return sum(n for kk, n in h.items() if int(kk.split('|')[1]) >= lo and (b is None or kk.split('|')[0] == b))
        print(f"      minutes holding any: {x['anyMin90']} of {x['minutes']} ({100 * x['anyMin90'] / x['minutes']:.1f} %) at .90, {x['anyMin95']} at .95; the largest single market holding >= $25: {mins(25)} min, >= $50: {mins(50)} ({mins(50, '>=.95')} of them a token >= .95), >= $75: {mins(75)}, >= $90: {mins(90)}")
        if o['stops']: print(f"      total stop hit on: {o['stops']}")
    print(f"\n   arms (each less L1 at R; boot = index 100 of 2,000 paired day draws; worst-all / worst-one = the most held at the mark in tokens >= .90, all markets / one market)")
    print(f"   {'fill':8} {'R':>4} {'arm':18} | {'total':>8} {'diff':>8} | {'ahd':>3} {'bhd':>3} | {'worst':>7} | {'boot100':>8} {'P>0':>5} | {'reward':>8} {'fillsP&L':>8} | {'worst-all':>9} {'worst-one':>9} {'one>=50 min':>11} {'mean .90':>8}")
    for fill, k in (('strict', rec), ('at-price', rec + '_atprice')):
        base = E[k]['L1']
        for R in (0.4, 1.0):
            b = fig(base, R)
            for arm, o in E[k].items():
                a = fig(o, R); D = [x - y for x, y in zip(a, b)]
                p5, pos = boot(D) if arm != 'L1' else (0.0, 0.0)
                x = o['expo']; h = x['hist']
                one50 = sum(n for kk, n in h.items() if int(kk.split('|')[1]) >= 50)
                print(f"   {fill:8} {R:4.1f} {arm:18} | {sum(a):8.2f} {sum(D):+8.2f} | {sum(1 for d in D if d > 1e-9):3d} {sum(1 for d in D if d < -1e-9):3d} | {min(a):7.2f} | {p5:+8.2f} {pos:5.2f} | {o['end']['reward']:8.2f} {o['end']['fillsPnl']:+8.2f} | {x['max90']:9.2f} {x['maxOne90']:9.2f} {one50:11d} {x['sum90'] / x['minutes']:8.2f}")
            print()
