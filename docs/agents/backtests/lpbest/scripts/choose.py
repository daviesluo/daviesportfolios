# LP-BEST, step 6: the quiet-book family, its parameters chosen on TRAIN only (10-05 -> 10-08) in two stages, each by the
# highest 5 % bound of the market-day bootstrap (the mean picks the luckiest carried stock: results/choose_by_mean.txt), then read once
# on TEST (10-09 -> 10-12) and on the whole span; with R and the fill volume moved, and at $316, $400 and $1,000.
#   LPBEST_WORK=<scratch> python3 -I docs/agents/backtests/lpbest/scripts/choose.py > results/choose.txt
#   LPBEST_CHOOSE_BY=per_day ... > results/choose_by_mean.txt (the same stages picking by the mean)
import os, sys, json, itertools
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, engine, strat, runs
from engine import P

# how each stage picks on TRAIN: 'lo' (the default: the highest 5 % bound) or 'per_day' (the mean; LPBEST_CHOOSE_BY=per_day)
CRIT = os.environ.get('LPBEST_CHOOSE_BY', 'lo')
# what "quiet" is read from: pm-rec's tape in the minutes it recorded the book (max_p_vol), or, on the data API's tape
# (LPBEST_API_TAPE=1), every print of the prior 24 hours as a live path reading the API would see them (max_api_vol)
QKEY = 'max_api_vol' if lib.TAG else 'max_p_vol'

def run_one(args):
    label, polkw, selkw, days, eq, extra = args
    cap = runs.cap_of(eq)
    pol = P(name=label, cap_total=cap, cap_market=min(100.0, cap), **polkw)
    sel = runs.sel_gen(eq=eq, **selkw)
    sch = strat.schedule(sel, days)
    o, res = strat.price(pol, sch, days, label=label)
    o['polkw'] = polkw; o['selkw'] = selkw
    return o

def table(outs, title):
    print(f"\n== {title}")
    for o in outs: print(strat.fmt(o))

def best_of(outs):
    return max(outs, key=lambda o: o['per_day'])

if __name__ == '__main__':
    EQ = 316.0
    R = engine.calib()['R_engine']
    print(f"LP-BEST: the quiet-book family, chosen on TRAIN by {CRIT}. Equity $316 (cap $236), R {R:.3f}, k_vol {engine.calib()['k_vol']:.3f}")
    # stage 1: which books (prints the day before, the touch, neg-risk) and which ranking, at RW's price, 5N, 15 markets
    G = []
    for pv, wc, neg, rank in itertools.product((0.5, 50, 200, 1000), (2, 3, 4), (True, None), ('lag', 'rw')):
        selkw = dict(rank=rank, lag_place='inside', k=15, frac=0.9, min_width_c=wc, neg_risk=neg, **{QKEY: pv})
        polkw = dict(min_width_c=wc)
        G.append((f'S1 vol<={pv:g} touch>={wc}c neg={neg} rank {rank}', polkw, selkw, strat.TRAIN, EQ, {}))
    with Pool(4) as pool: o1 = pool.map(run_one, G, chunksize=1)
    o1.sort(key=lambda o: -o[CRIT])
    table(o1[:12], f'stage 1 on TRAIN, the twelve best of 48 by {CRIT} (books x ranking)')
    b1 = o1[0]
    print(f"   chosen: {b1['label']}")
    # stage 2: around it, how it quotes (placement, inventory cap, size, the 10 c hour, markets)
    G = []
    for place, k in (('inside', 0), ('behind', 1)):
        for inv, sm, rng, kk in itertools.product((1, 2, 5), (1, 2), (None, 10), (10, 15, 25)):
            polkw = dict(b1['polkw'], place=place, k=k, inv_cap=inv / sm if sm > 1 else inv, size_mult=sm, range_c=rng)
            selkw = dict(b1['selkw'], k=kk, size_mult=sm, lag_place='inside' if place == 'inside' else f'behind{k}')
            G.append((f'S2 {place}{k if k else ""} inv {inv}N size {sm}N 10c-hour {rng} k {kk}', polkw, selkw, strat.TRAIN, EQ, {}))
    with Pool(4) as pool: o2 = pool.map(run_one, G, chunksize=1)
    o2.sort(key=lambda o: -o[CRIT])
    table(o2[:12], f'stage 2 on TRAIN, the twelve best of 72 by {CRIT} (how it quotes)')
    b2 = o2[0]
    print(f"   chosen: {b2['label']}")
    # the read: TEST once, the whole span, and the neighbours of the choice on TEST (how sharp the optimum is)
    fin = []
    for span, days in (('TRAIN', strat.TRAIN), ('TEST', strat.TEST), ('ALL', strat.DAYS)):
        fin.append((f'CHOSEN [{span}]', b2['polkw'], b2['selkw'], days, EQ, {}))
    for o in o2[1:6]:
        fin.append((o['label'] + ' [TEST]', o['polkw'], o['selkw'], strat.TEST, EQ, {}))
    with Pool(4) as pool: of = pool.map(run_one, fin, chunksize=1)
    table(of, 'the choice read once on TEST and on the whole span; the next five of stage 2 on TEST')
    # sensitivity on the whole span: R and the fill volume
    sens = []
    for Rv in (0.30, R, 0.61):
        for kv in (1.0, engine.calib()['k_vol'], 1.6):
            sens.append((f'CHOSEN ALL  R {Rv:.2f} k_vol {kv:.2f}', dict(b2['polkw'], R2=Rv, k_vol=kv), dict(b2['selkw'], R=Rv), strat.DAYS, EQ, {}))
    with Pool(4) as pool: os_ = pool.map(run_one, sens, chunksize=1)
    table(os_, 'sensitivity, whole span: R (the live R 0.42 in the engine units; 0.61 with none of the live path\'s friction) x fill volume')
    # capital
    caps = []
    for eq in (316.0, 400.0, 1000.0):
        for span, days in (('TEST', strat.TEST), ('ALL', strat.DAYS)):
            k = max(5, int(round(b2['selkw']['k'] * (eq - 80) / 236)))
            caps.append((f'CHOSEN at ${eq:.0f} equity (cap ${eq - 80:.0f}, k {k}) [{span}]', b2['polkw'], dict(b2['selkw'], k=k), days, eq, {}))
    with Pool(4) as pool: oc = pool.map(run_one, caps, chunksize=1)
    table(oc, 'capital: the same rule at $316, $400 and $1,000 of equity (markets scaled with the cap)')
    json.dump({'crit': CRIT, 'stage1': o1, 'stage2': o2, 'final': of, 'sens': os_, 'caps': oc, 'chosen': {'polkw': b2['polkw'], 'selkw': b2['selkw']}},
              open(os.path.join(lib.WORK, f'choose_{CRIT}{lib.TAG}.json'), 'w'), default=float, indent=1)
