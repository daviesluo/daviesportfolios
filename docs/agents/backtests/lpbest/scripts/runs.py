# LP-BEST, step 5: every strategy through the engine over the pm-rec universe, 2026-10-05 -> 10-12, chosen each UTC day at
# 00:00 from the day table's features, at a given equity. Out of sample in time: parameters are compared on TRAIN
# (10-05 -> 10-08), and the report quotes TEST (10-09 -> 10-12, the live days) and the whole span; a market-day
# bootstrap gives each a 5-95 % range.
#   LPBEST_WORK=<scratch> python3 -I docs/agents/backtests/lpbest/scripts/runs.py <grid> > results/<grid>.txt
# <grid>: 'base' (the families), 'refine' (around the best on TRAIN), 'size' (the chosen ones at $316 / $400 / $1,000).
import os, sys, json
import numpy as np, pandas as pd
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, engine, strat
from engine import P

EQ = float(os.environ.get('LPBEST_EQUITY', '316'))

def cap_of(eq, buffer=80.0):
    return max(0.0, eq - buffer)

def sel_rw(k=10, frac=200 / 320, eq=EQ, **elig):
    """live-prep's selection: RW's reward per dollar of first quotes (`firstScore`), whole markets in that order, ten at
    most, inside a first-quote budget (live-prep: $200 of $320)."""
    budget = frac * cap_of(eq)
    def f(day_df):
        x = strat.eligible(day_df, **elig)
        return strat.choose(x, x.est0 / x.cap0, budget, k)
    return f

def sel_value(k=10, frac=200 / 320, eq=EQ, R=None, beta=0.0, tox_w=0.0, size_mult=1.0, **elig):
    """Reward net of the fills' expected cost: R x the 00:00 formula estimate a day, less beta x the last 24 hours'
    taker volume (shares, capped at 2,000) and tox_w x the last 24 hours' taker markout (the takers' 60-minute gain in $,
    positive when they won), per dollar of first quotes."""
    budget = frac * cap_of(eq)
    Rv = R if R is not None else engine.calib()['R_engine']
    def f(day_df):
        x = strat.eligible(day_df, **elig)
        val = Rv * x.est0 * size_mult - beta * np.minimum(x.p_vol, 2000) - tox_w * x.p_tox.clip(lower=0)
        return strat.choose(x, val / (x.cap0 * size_mult), budget, k, size_mult)
    return f

def sel_gen(rank='rw', lag_place='behind1', k=10, frac=200 / 320, eq=EQ, size_mult=1.0, R=None, **elig):
    """A general selection: the eligible markets ranked by RW's per-dollar score ('rw'), by the 00:00 formula estimate
    itself ('est'), or by the market's own previous day at a placement, rewards at R plus its fills marked at 240
    minutes, per dollar ('lag'; a market with no previous day ranks by 'rw' after those that have one)."""
    budget = frac * cap_of(eq)
    Rv = R if R is not None else engine.calib()['R_engine']
    def f(day_df):
        x = strat.eligible(day_df, **elig)
        if rank == 'rw': s = x.est0 / x.cap0
        elif rank == 'est': s = x.est0
        else:
            lag = (Rv * x[f'lag_{lag_place}_f2w'] + x[f'lag_{lag_place}_mo240']) / (x.cap0 * size_mult)
            s = lag.where(lag.notna(), -1e-6 + 1e-9 * (x.est0 / x.cap0))
        return strat.choose(x, s, budget, k, size_mult)
    return f

def job(args):
    label, pol, selname, selkw, days = args
    sel = {'rw': sel_rw, 'value': sel_value, 'gen': sel_gen}[selname](**selkw)
    sch = strat.schedule(sel, days)
    o, res = strat.price(pol, sch, days, label=label)
    return o

def grid_base(eq):
    cap = cap_of(eq)
    B = dict(cap_total=cap, cap_market=min(100.0, cap))
    G = []
    def add(label, sel='rw', selkw=None, **kw):
        G.append((label, P(name=label, **B, **kw), sel, dict(eq=eq, **(selkw or {}))))
    add('A0 live-prep unchanged (RW price, 5N, TB1, x2 pause)')
    add('A1 P1: + no entry after a 10 c hour, touch >= 3 c', range_c=10, min_width_c=3)
    add('A2 P1 + view-count and statements out', range_c=10, min_width_c=3, exclude_types=('view-count', 'statements'),
        selkw=dict(exclude_types=('view-count', 'statements')))
    add('A3 inventory cap 1Q (from 5N)', inv_cap=1)
    add('A4 inventory cap 2Q', inv_cap=2)
    add('A5 P1 + inventory cap 1Q', range_c=10, min_width_c=3, inv_cap=1)
    add('B1 entries at the touch (join), exits a tick inside', place='join')
    add('B2 entries 1 tick behind the touch', place='behind', k=1)
    add('B3 entries 2 ticks behind the touch', place='behind', k=2)
    add('B4 entries 1 tick behind, exits at the touch', place='behind', k=1, exit_place='join')
    add('B5 join + P1 filters', place='join', range_c=10, min_width_c=3)
    add('C1 two-sided only (no one-sided entries)', two_sided_only=True)
    add('C2 no exits worked (hold to the end; diagnostic)', exits=False)
    add('D1 quiet books: touch >= 3 c and prior-day taker volume <= 200', min_width_c=3, selkw=dict(max_p_vol=200))
    add('D2 quiet: no print in the prior 24 h', selkw=dict(max_p_vol=0.5))
    add('D3 far from the end: >= 14 days', selkw=dict(min_dte=14))
    add('D4 far from the end >= 14 d + P1', range_c=10, min_width_c=3, selkw=dict(min_dte=14))
    add('E1 value selection (reward less 0.002 $/share of prior volume)', sel='value', selkw=dict(beta=0.002))
    add('E2 value selection (beta 0.005)', sel='value', selkw=dict(beta=0.005))
    add('E3 value selection (taker markout weight 1)', sel='value', selkw=dict(tox_w=1.0))
    add('F1 size 2N', size_mult=2, inv_cap=2.5)
    add('F2 size 2N, 1 tick behind', size_mult=2, inv_cap=2.5, place='behind', k=1)
    add('F3 size 3N, 2 ticks behind', size_mult=3, inv_cap=2, place='behind', k=2)
    add('G1 five markets only', selkw=dict(k=5))
    add('G2 twenty markets', selkw=dict(k=20, frac=0.9))
    return G

def grid_quiet(eq):
    """The slice the rule search found positive on both spans (quiet books, quotes behind the touch), chosen on TRAIN in
    the engine: placements x filters x rankings."""
    cap = cap_of(eq)
    B = dict(cap_total=cap, cap_market=min(100.0, cap))
    G = []
    filters = {
        'all': {},
        'quiet': dict(max_p_vol=200, min_width_c=3),
        'quiet+neg': dict(max_p_vol=200, min_width_c=3, neg_risk=True),
        'quiet+notoxic': dict(max_p_vol=200, min_width_c=3, exclude_types=('view-count', 'statements', 'box office')),
        'elections<=200': dict(max_p_vol=200, only_types=('elections',)),
    }
    for place, k in (('inside', 0), ('behind', 1), ('behind', 2)):
        tag = 'inside' if place == 'inside' else f'behind{k}'
        for fname, fkw in filters.items():
            for rank in ('rw', 'lag'):
                pkw = dict(place=place, k=k)
                if 'min_width_c' in fkw: pkw['min_width_c'] = fkw['min_width_c']
                label = f'Q {tag:<8} {fname:<14} rank {rank}'
                G.append((label, P(name=label, **B, **pkw), 'gen', dict(eq=eq, rank=rank, lag_place=tag, k=15, frac=0.9, **fkw)))
    return G

if __name__ == '__main__':
    which = sys.argv[1] if len(sys.argv) > 1 else 'base'
    G = {'base': grid_base, 'quiet': grid_quiet}[which](EQ)
    jobs = []
    for (label, pol, sel, selkw) in G:
        for span, days in (('TRAIN', strat.TRAIN), ('TEST', strat.TEST)):
            jobs.append((f'{label} [{span}]', pol, sel, selkw, days))
    with Pool(4) as pool:
        outs = pool.map(job, jobs, chunksize=1)
    print(f"LP-BEST strategies ({which}) at equity ${EQ:.0f}: cap ${cap_of(EQ):.0f} (equity less the $80 the stop and its margin keep), "
          f"R {engine.calib()['R_engine']:.3f}, k_vol {engine.calib()['k_vol']:.3f}")
    print("$ a day [5 %, 95 % over market-days]; rew = rewards, fills = the fills marked to the span's end, reb = rebates; sh/d = filled shares a day")
    for o in outs: print(strat.fmt(o))
    json.dump(outs, open(os.path.join(lib.WORK, f'runs_{which}_{int(EQ)}.json'), 'w'), default=float, indent=1)
