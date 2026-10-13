# LP-BEST, step 8: the deliverable's table. Each candidate through the same engine: the whole pm-rec span (10-05 -> 10-12)
# and TEST (10-09 -> 10-12, the live days) at $316, the whole span at $400 and $1,000; its worst day and the capital it
# used; and on RW-C's own daily selections (10-08 -> 10-12, RW's universe as RW-C's paper picked it). Ranges are 5-95 %
# over market-days.
#   LPBEST_WORK=<scratch> LPADV_WORK=<LP-ADVERSE scratch> python3 -I docs/agents/backtests/lpbest/scripts/ranking.py > results/ranking.txt
import os, sys, json, collections
import numpy as np
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, engine, strat, runs
from engine import P

ch = json.load(open(os.path.join(lib.WORK, f'choose_lo{lib.TAG}.json')))['chosen']
QP, QS = ch['polkw'], ch['selkw']
QKEY = 'max_api_vol' if lib.TAG else 'max_p_vol'
ALT = 0.5 if QS[QKEY] >= 50 else 50   # the neighbouring threshold the stage-1 grid also had
CANDS = [
    (f'Q  quiet books (chosen): <= {QS[QKEY]:g} shares traded in 24 h, touch >= {QS["min_width_c"]:g} c, RW price, N', 'gen', QS, QP),
    ('Q2 quiet books, 2N inventory cap', 'gen', QS, dict(QP, inv_cap=2)),
    (f'Q3 the neighbour: <= {ALT:g} shares traded in 24 h', 'gen', dict(QS, **{QKEY: ALT}), QP),
    ('Q4 quiet books, quotes 1 tick behind the touch', 'gen', dict(QS, lag_place='behind1'), dict(QP, place='behind', k=1)),
    ('P1 live-prep + 10 c hour + touch >= 3 c (LP-ADVERSE)', 'rw', {}, dict(range_c=10, min_width_c=3)),
    ('P2 P1 + view-count and statements out', 'rw', dict(exclude_types=('view-count', 'statements')), dict(range_c=10, min_width_c=3, exclude_types=('view-count', 'statements'))),
    ('P4 P1 + entries 1 tick behind the touch', 'rw', {}, dict(range_c=10, min_width_c=3, place='behind', k=1, exit_place='inside')),
    ('A0 live-prep unchanged', 'rw', {}, {}),
]

def run_one(args):
    label, selname, selkw, polkw, days, eq, sched = args
    cap = runs.cap_of(eq)
    pol = P(name=label, cap_total=cap, cap_market=min(100.0, cap), **polkw)
    if sched is None:
        k = selkw.get('k', 10)
        sk = dict(selkw)
        if selname == 'gen': sk['k'] = max(5, int(round(k * cap / 236)))
        else: sk['k'] = max(5, int(round(10 * cap / 236)))
        sel = (runs.sel_gen if selname == 'gen' else runs.sel_rw)(eq=eq, **sk)
        sched = strat.schedule(sel, days)
    o, res = strat.price(pol, sched, days, label=label)
    return o

def rwc_schedule(filt=None):
    """RW-C's own picks each day (LP-ADVERSE's paper.json), in its rank order; `filt` keeps only those the chosen rule's
    00:00 filters pass (from the day table)."""
    import gzip
    pj = json.load(open(os.path.join(os.environ['LPADV_WORK'], 'paper.json')))
    cond2id = {v['cond']: k for k, v in lib.meta().items()}
    dt = strat.daytable().set_index(['cond', 'day'])
    s = collections.defaultdict(list)
    for (day, cond, rank, rate, v, ms, tick, q, end) in sorted(pj['rwc_sel'], key=lambda r: (r[0], r[2])):
        mid = cond2id.get(cond)
        if mid is None or day not in strat.DAYS: continue
        if filt is not None:
            try: row = dt.loc[(cond, day)]
            except KeyError: continue
            if isinstance(row, type(dt)): row = row.iloc[0]
            if not filt(row): continue
        s[day].append((mid, rank, None))
    return dict(s)

if __name__ == '__main__':
    jobs = []
    for (label, sel, sk, pk) in CANDS:
        jobs.append((label + ' | ALL $316', sel, sk, pk, strat.DAYS, 316.0, None))
        jobs.append((label + ' | TEST $316', sel, sk, pk, strat.TEST, 316.0, None))
        jobs.append((label + ' | ALL $400', sel, sk, pk, strat.DAYS, 400.0, None))
        jobs.append((label + ' | ALL $1000', sel, sk, pk, strat.DAYS, 1000.0, None))
    rdays = [d for d in strat.DAYS if d >= '2026-10-08']
    quiet = lambda r: (r['p_vol_api' if lib.TAG else 'p_vol'] <= QS[QKEY]) and (r['width0_c'] >= QS['min_width_c'])
    jobs.append(("RW-C's picks, live-prep's rule | RW-C 10-08 -> 10-12 $316", 'rw', {}, {}, rdays, 316.0, rwc_schedule()))
    jobs.append(("RW-C's picks, P1 | RW-C 10-08 -> 10-12 $316", 'rw', {}, dict(range_c=10, min_width_c=3), rdays, 316.0, rwc_schedule()))
    jobs.append(("RW-C's picks that are quiet books, Q's rule | RW-C 10-08 -> 10-12 $316", 'gen', QS, QP, rdays, 316.0, rwc_schedule(quiet)))
    with Pool(4) as pool:
        outs = pool.map(run_one, jobs, chunksize=1)
    print("LP-BEST ranking: each candidate through the one engine (R %.3f in the engine's units, k_vol %.3f); $ a day [5 %%, 95 %% over market-days]" %
          (engine.calib()['R_engine'], engine.calib()['k_vol']))
    print("cap = equity less $80 (the stop and its margin); markets scaled with the cap; the not-restarted path is $0 a day, no risk\n")
    for o in outs: print(strat.fmt(o))
    sch = rwc_schedule(); schq = rwc_schedule(quiet)
    print(f"\nRW-C's picks 10-08 -> 10-12: {sum(len(v) for v in sch.values())} market-days; of them quiet books by Q's filters: {sum(len(v) for v in schq.values())}")
    json.dump(outs, open(os.path.join(lib.WORK, f'ranking{lib.TAG}.json'), 'w'), default=float, indent=1)
