# LP-BEST, step 4: where the reward money is and what it costs, over the pm-rec universe (the day table): every
# eligible market-day (live-prep's universe rules: $10 a day or more, N <= 20, no weather, no AI, no game within two
# days), a stateless two-sided quote of N a side at each placement, priced at the engine's R and its fills marked at
# 60 and 240 minutes. Then the same split by what was knowable at 00:00, to find which markets pay for their fills.
#   LPBEST_WORK=<scratch> python3 -I docs/agents/backtests/lpbest/scripts/analysis.py > results/universe.txt
import os, sys, json
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, engine, strat

R = engine.calib().get('R_engine')
df = strat.daytable()
e = strat.eligible(df)
pd.set_option('display.width', 250)
PL = ['inside', 'join', 'behind1', 'behind2', 'behind3']

def net(x, tag, h='60'):
    return R * x[f'{tag}_f2w'] + (x[f'{tag}_mo{h}w'] if h == '60' else x[f'{tag}_mo240'])

print("LP-BEST: the universe, market-day by market-day (stateless two-sided quotes of N a side, every minute the raw touch is")
print(f"at least two ticks wide; R {R:.3f} in the engine's units, fills x k_vol {engine.calib()['k_vol']:.3f})")
print(f"market-days in the table: {len(df)}; eligible (live-prep's universe, N <= 20): {len(e)} over {e.mid.nunique()} markets")
print(e.groupby('day').size().to_string())
print("\n== By placement, all eligible market-days ($ a day over the 8 days)")
nd = len(strat.DAYS)
print(f"{'placement':<10}{'formula':>9}{'rewards':>9}{'fill sh':>9}{'mo60':>9}{'c/sh':>7}{'net60':>9}{'mo240':>9}{'net240':>9}")
for tag in PL:
    f2 = e[f'{tag}_f2w'].sum() / nd; sh = e[f'{tag}_shw'].sum() / nd; mo = e[f'{tag}_mo60w'].sum() / nd; m4 = e[f'{tag}_mo240'].sum() / nd
    print(f"{tag:<10}{f2:>9.1f}{R * f2:>9.1f}{sh:>9.0f}{mo:>9.1f}{100 * mo / max(sh, 1):>7.2f}{R * f2 + mo:>9.1f}{m4:>9.1f}{R * f2 + m4:>9.1f}")

def split(col, bins, tag='inside', labels=None):
    x = e.copy()
    x['bin'] = pd.cut(x[col], bins, labels=labels, include_lowest=True)
    g = x.groupby('bin', observed=True)
    out = pd.DataFrame({'mkt-days': g.size(), 'rewards': g[f'{tag}_f2w'].sum() * R, 'mo60': g[f'{tag}_mo60w'].sum(), 'sh': g[f'{tag}_shw'].sum(),
                        'mo240': g[f'{tag}_mo240'].sum()})
    out['net60'] = out.rewards + out.mo60; out['net240'] = out.rewards + out.mo240
    out['net60/mkt-day'] = out.net60 / out['mkt-days']
    return out.round(2)

print("\n== Inside (RW's price), by type")
x = e.copy()
g = x.groupby('type')
t = pd.DataFrame({'mkt-days': g.size(), 'rewards': g.inside_f2w.sum() * R, 'mo60': g.inside_mo60w.sum(), 'sh': g.inside_shw.sum(), 'mo240': g.inside_mo240.sum()})
t['net60'] = t.rewards + t.mo60; t['net240'] = t.rewards + t.mo240; t['net60/mkt-day'] = t.net60 / t['mkt-days']
print(t.sort_values('net60').round(2).to_string())
print("\n== Inside, by the prior 24 hours' taker volume (shares)")
print(split('p_vol', [-1, 0.5, 50, 200, 1000, 5000, 1e9]).to_string())
print("\n== Inside, by the prior 24 hours' mid range (cents)")
print(split('p_range', [-1, 1, 3, 6, 10, 20, 101]).to_string())
print("\n== Inside, by the touch at 00:00 (cents)")
print(split('width0_c', [0, 1.01, 2.01, 3.01, 5.01, 10.01, 101]).to_string())
print("\n== Inside, by days to the end")
print(split('dte', [0, 3, 7, 14, 30, 90, 10000]).to_string())
print("\n== Inside, by the selection's formula estimate per day at 00:00 (rate x share, $)")
print(split('est0', [0, 1, 3, 10, 30, 100, 1e6]).to_string())
print("\n== Inside, by the selection's estimate per dollar of first quotes (RW's score x 1440)")
x = e.assign(pd_=e.est0 / e.cap0)
x['bin'] = pd.qcut(x.pd_, 5)
g = x.groupby('bin', observed=True)
t = pd.DataFrame({'mkt-days': g.size(), 'rewards': g.inside_f2w.sum() * R, 'mo60': g.inside_mo60w.sum(), 'mo240': g.inside_mo240.sum()})
t['net60'] = t.rewards + t.mo60; t['net60/mkt-day'] = t.net60 / t['mkt-days']
print(t.round(2).to_string())
print("\n== Each placement's net60 by the prior 24 hours' taker volume: where deeper quotes pay")
for tag in PL:
    s = split('p_vol', [-1, 0.5, 200, 5000, 1e9], tag=tag)
    print(tag, ' | '.join(f"{i}: {r['net60']:+.1f} ({r['mkt-days']})" for i, r in s.iterrows()))
print("\n== Inside, by the mid at 00:00 (two-sided only outside 0.10-0.90)")
print(split('mid0', [0, 0.05, 0.10, 0.25, 0.5, 0.75, 0.90, 0.95, 1.0]).to_string())
print("\n== Inside, by our share of the pool at 00:00 (est0 / rate0: our score over ours + the others')")
e['share'] = e.est0 / e.rate0
print(split('share', [0, 0.01, 0.03, 0.1, 0.3, 1.0]).to_string())
# the realised day's toxicity against the prior day's: is a market's flow persistent?
x = e[(e.p_vol > 0) & (e.d_vol > 0)]
c = np.corrcoef(np.log1p(x.p_vol), np.log1p(x.d_vol))[0, 1]
c2 = np.corrcoef(x.p_tox / x.p_vol, x.d_tox / x.d_vol)[0, 1]
print(f"\npersistence: corr(log prior-day taker volume, log the day's) {c:.2f} over {len(x)} market-days; corr(prior-day taker markout a share, the day's) {c2:.2f}")
