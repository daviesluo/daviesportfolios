# LP-BEST, step 4b: is there a slice of the reward universe where quoting pays, and does it hold out of sample? Every
# rule of up to three conditions on what was knowable at 00:00 (type, mid, touch, the last 24 hours' prints and range,
# days to the end, our share of the pool, the rate), at each placement, scored on the day table's stateless quotes
# (rewards at the engine's R, fills marked at 240 minutes): chosen on TRAIN (10-05 -> 10-08), read on TEST (10-09 -> 10-12).
#   LPBEST_WORK=<scratch> python3 -I docs/agents/backtests/lpbest/scripts/search.py > results/search.txt
import os, sys, itertools
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, engine, strat

R = engine.calib()['R_engine']
df = strat.daytable()
e = strat.eligible(df).copy()
e['share'] = e.est0 / e.rate0
CONDS = {
    'mid <0.10 or >0.90': lambda x: (x.mid0 < 0.10) | (x.mid0 > 0.90),
    'mid 0.10-0.90': lambda x: (x.mid0 >= 0.10) & (x.mid0 <= 0.90),
    'mid 0.25-0.75': lambda x: (x.mid0 >= 0.25) & (x.mid0 <= 0.75),
    'no print 24h': lambda x: x.p_vol <= 0.5,
    'prior vol <= 200': lambda x: x.p_vol <= 200,
    'prior vol > 200': lambda x: x.p_vol > 200,
    'range24 < 3c': lambda x: x.p_range < 3,
    'range24 < 6c': lambda x: x.p_range < 6,
    'range24 >= 10c': lambda x: x.p_range >= 10,
    'touch >= 3c': lambda x: x.width0_c >= 3 - 1e-9,
    'touch <= 2c': lambda x: x.width0_c <= 2 + 1e-9,
    'dte >= 30': lambda x: x.dte.isna() | (x.dte >= 30),
    'dte >= 14': lambda x: x.dte.isna() | (x.dte >= 14),
    'dte < 14': lambda x: x.dte < 14,
    'share >= 0.1': lambda x: x.share >= 0.1,
    'share < 0.03': lambda x: x.share < 0.03,
    'rate >= 50': lambda x: x.rate0 >= 50,
    'rate < 25': lambda x: x.rate0 < 25,
    'elections': lambda x: x.type == 'elections',
    'news/geo': lambda x: x.type == 'news/geo deadline',
    'econ/earnings': lambda x: x.type == 'earnings/econ data',
    'sports': lambda x: x.type == 'sports',
    'no view-count/statements/box office': lambda x: ~x.type.isin(['view-count', 'statements', 'box office']),
    'neg-risk': lambda x: x.neg.astype(str).str.lower() == 'true',
    'not neg-risk': lambda x: x.neg.astype(str).str.lower() != 'true',
}
PL = ['inside', 'join', 'behind1', 'behind2', 'behind3']
tr = e[e.day.isin(strat.TRAIN)]; te = e[e.day.isin(strat.TEST)]
masks_tr = {k: f(tr).fillna(False).to_numpy() for k, f in CONDS.items()}
masks_te = {k: f(te).fillna(False).to_numpy() for k, f in CONDS.items()}
rows = []
names = list(CONDS)
for r in (1, 2, 3):
    for combo in itertools.combinations(names, r):
        mtr = np.logical_and.reduce([masks_tr[c] for c in combo]); mte = np.logical_and.reduce([masks_te[c] for c in combo])
        if mtr.sum() < 40 or mte.sum() < 20: continue
        for p in PL:
            ntr = (R * tr[f'{p}_f2w'].to_numpy()[mtr] + tr[f'{p}_mo240'].to_numpy()[mtr])
            nte = (R * te[f'{p}_f2w'].to_numpy()[mte] + te[f'{p}_mo240'].to_numpy()[mte])
            n60tr = (R * tr[f'{p}_f2w'].to_numpy()[mtr] + tr[f'{p}_mo60w'].to_numpy()[mtr])
            n60te = (R * te[f'{p}_f2w'].to_numpy()[mte] + te[f'{p}_mo60w'].to_numpy()[mte])
            rows.append((' & '.join(combo), p, mtr.sum(), ntr.sum() / 4, ntr.mean(), mte.sum(), nte.sum() / 4, nte.mean(), n60tr.sum() / 4, n60te.sum() / 4,
                         R * tr[f'{p}_f2w'].to_numpy()[mtr].sum() / 4, R * te[f'{p}_f2w'].to_numpy()[mte].sum() / 4))
res = pd.DataFrame(rows, columns=['rule', 'place', 'n_tr', 'tr_$day', 'tr_$mktday', 'n_te', 'te_$day', 'te_$mktday', 'tr60_$day', 'te60_$day', 'tr_rew_$day', 'te_rew_$day'])
pd.set_option('display.width', 250); pd.set_option('display.max_colwidth', 70)
print(f"LP-BEST rule search: {len(res)} (rule, placement) pairs of up to three conditions, each with >= 40 TRAIN and >= 20 TEST market-days")
print(f"R {R:.3f}; net = rewards + fills marked at 240 minutes ($ a day over 4 days; the 60-minute marks beside them)")
print(f"positive on TRAIN: {(res['tr_$day'] > 0).sum()}; positive on both: {((res['tr_$day'] > 0) & (res['te_$day'] > 0)).sum()}; "
      f"positive on TEST alone: {(res['te_$day'] > 0).sum()}")
top = res.sort_values('tr_$day', ascending=False).head(25)
print("\n== The 25 best on TRAIN, and what they did on TEST")
print(top.round(2).to_string(index=False))
c = np.corrcoef(res['tr_$mktday'], res['te_$mktday'])[0, 1]
print(f"\ncorrelation of a rule's TRAIN $ a market-day with its TEST $ a market-day, over every pair: {c:.2f}")
best = res[(res['tr_$day'] > 0) & (res['te_$day'] > 0)].sort_values('te_$day', ascending=False).head(15)
print("\n== Positive on both spans (best on TEST first; chosen after seeing TEST: descriptive only)")
print(best.round(2).to_string(index=False))
res.to_csv(os.path.join(lib.WORK, 'search.csv.gz'), index=False)
