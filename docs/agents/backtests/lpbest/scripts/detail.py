# LP-BEST, step 7: the chosen strategy (choose.py's pick by the 5 % bound) opened up: day by day, market by market, what
# it picked, how concentrated the result is, its fills and their markouts, the neighbours of its two thresholds on TEST,
# and what the same span gives live-prep's rule unchanged and P1 (LP-ADVERSE's best package) in the same engine.
#   LPBEST_WORK=<scratch> python3 -I docs/agents/backtests/lpbest/scripts/detail.py > results/detail.txt
import os, sys, json, collections
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, engine, strat, runs
from engine import P

ch = json.load(open(os.path.join(lib.WORK, f'choose_lo{lib.TAG}.json')))['chosen']
polkw, selkw = ch['polkw'], ch['selkw']
QKEY = 'max_api_vol' if lib.TAG else 'max_p_vol'
EQ = 316.0
cap = runs.cap_of(EQ)
print("LP-BEST: the chosen strategy opened up (choose.py, picked on TRAIN by the 5 % bound)")
print(f"policy: {polkw}\nselection: {selkw}\nequity ${EQ:.0f}, cap ${cap:.0f}, R {engine.calib()['R_engine']:.3f}, k_vol {engine.calib()['k_vol']:.3f}\n")
pol = P(name='chosen', cap_total=cap, cap_market=min(100.0, cap), **polkw)
sel = runs.sel_gen(eq=EQ, **selkw)
sch = strat.schedule(sel, strat.DAYS)
o, res = strat.price(pol, sch, strat.DAYS, label='chosen, whole span')
print(strat.fmt(o))
print("\n== Day by day")
print(f"{'day':<12}{'picked':>7}{'2-sided min':>12}{'formula2':>10}{'rewards':>9}{'fills':>7}{'shares':>8}{'mo60':>8}{'fills P&L':>11}{'total':>8}{'held at end':>12}")
for d in strat.DAYS:
    x = res['daily'].get(d, {})
    print(f"{d:<12}{len(sch.get(d, [])):>7}{x.get('minutes2', 0):>12.0f}{x.get('formula2', 0):>10.2f}{x.get('paid', 0):>9.2f}{x.get('fills', 0):>7.0f}"
          f"{x.get('shares', 0):>8.0f}{x.get('mo60', 0):>8.2f}{x.get('fills_day', 0):>11.2f}{x.get('total', 0):>8.2f}{x.get('held', 0):>12.2f}")
dt = strat.daytable().set_index(['mid', 'day'])
cov = [dt.loc[(mid, d), 'minutes'] / 1440 for d, lst in sch.items() for (mid, r, s) in lst]
print(f"the picked market-days were recorded by pm-rec {100 * np.mean(cov):.0f} % of each day on average (median {100 * np.median(cov):.0f} %): "
      f"the engine quotes only recorded minutes")
tots = [res['daily'][d]['total'] for d in strat.DAYS]
print(f"daily totals: mean {np.mean(tots):+.2f}, sd {np.std(tots, ddof=1):.2f}, worst {min(tots):+.2f}, best {max(tots):+.2f}")
print("\n== By market (the 15 that made most and the 10 that lost most; P&L = fills marked at the end + rewards + rebates)")
bk = sorted(res['books'].items(), key=lambda kv: -(kv[1]['pnl'] + kv[1]['paid'] + kv[1]['rebate']))
def line(mid, b):
    q = (lib.meta().get(int(mid), {}).get('q') or '')[:70]
    return f"  {b['cond'][:10]} {b['type']:<20}{b['pnl'] + b['paid'] + b['rebate']:>+8.2f}  rew {b['paid']:>6.2f} fills {b['pnl']:>+7.2f} sh {b['shares']:>6.0f} 2-sided min {b['minutes2']:>6}  {q}"
for mid, b in bk[:15]: print(line(mid, b))
print("  ...")
for mid, b in bk[-10:]: print(line(mid, b))
tot = np.array([b['pnl'] + b['paid'] + b['rebate'] for b in res['books'].values()])
srt = np.sort(tot)[::-1]
print(f"markets {len(tot)}; the best market is {100 * srt[0] / tot.sum():.0f} % of the total, the best five {100 * srt[:5].sum() / tot.sum():.0f} %; "
      f"without the best market {(tot.sum() - srt[0]) / 8:+.2f} a day, without the best five {(tot.sum() - srt[:5].sum()) / 8:+.2f} a day")
ty = collections.defaultdict(lambda: [0, 0.0])
for b in res['books'].values():
    ty[b['type']][0] += 1; ty[b['type']][1] += b['pnl'] + b['paid'] + b['rebate']
print("by type: " + '; '.join(f"{k} {v[0]} markets {v[1]:+.2f}" for k, v in sorted(ty.items(), key=lambda kv: -kv[1][1])))
print(f"\n== The neighbours of the two thresholds (the prior 24 hours' taker volume by {QKEY}; the touch), each on TRAIN and TEST")
for pv in (0.5, 20, 50, 200):
    for wc in (3, 4, 5):
        sk = dict(selkw, min_width_c=wc, **{QKEY: pv}); pk = dict(polkw, min_width_c=wc)
        out = []
        for days in (strat.TRAIN, strat.TEST):
            p = P(name='n', cap_total=cap, cap_market=min(100.0, cap), **pk)
            oo, _ = strat.price(p, strat.schedule(runs.sel_gen(eq=EQ, **sk), days), days, label='n')
            out.append(oo)
        print(f"  prior volume <= {pv:<4g} touch >= {wc}c   TRAIN {out[0]['per_day']:+6.2f} [{out[0]['lo']:+6.2f}, {out[0]['hi']:+6.2f}]   TEST {out[1]['per_day']:+6.2f} [{out[1]['lo']:+6.2f}, {out[1]['hi']:+6.2f}]")
print("\n== The same span, the same engine: live-prep unchanged and P1, at the same cap")
for lab, kw in (('live-prep unchanged', {}), ('P1 (10 c hour, touch >= 3 c)', dict(range_c=10, min_width_c=3))):
    p = P(name=lab, cap_total=cap, cap_market=min(100.0, cap), **kw)
    oo, _ = strat.price(p, strat.schedule(runs.sel_rw(eq=EQ), strat.DAYS), strat.DAYS, label=lab + ', whole span')
    print(strat.fmt(oo))
json.dump({'o': o, 'daily': res['daily']}, open(os.path.join(lib.WORK, f'detail{lib.TAG}.json'), 'w'), default=float)
