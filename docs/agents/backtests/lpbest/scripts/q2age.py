# Q2-AGE (2026-10-13): does Q2, the quiet-book rule live since 2026-10-13 13:25 UTC (live-prep's Addendum 19), do better
# when it leaves out markets younger than N days? PMOPPS (`reviews/2026-10-13-polymarket-opportunities.md` section 4,
# `backtests/pmopps/scripts/pool_age.py`) found quiet books under 3 days old losing on LP-BEST's stateless day table; this
# prices the filter through LP-BEST's capped engine, the one validated against live (`validate.py`), with Q2 exactly as
# deployed: quiet by the data API (<= 50 shares in the prior 24 h), touch >= 4 c at 00:00 and while quoting, RW's price,
# N a side, 2N, RW's per-dollar ranking, 12 markets at most inside 90 % of the cap (equity less $80).
#
# The age is the market's at the day's 00:00 UTC from Gamma's `createdAt`, read keylessly once a market (cached in
# $Q2AGE_CREATED, PMOPPS' created.json, any missing condition read again). N is chosen on TRAIN (10-05 -> 10-08) by the
# highest 5 % bound of the market-day bootstrap, as LP-BEST chose, and read once on TEST (10-09 -> 10-12).
#   LPBEST_WORK=<scratch> LPBEST_API_TAPE=1 Q2AGE_CREATED=<created.json> python3 -I docs/agents/backtests/lpbest/scripts/q2age.py > results/q2age.txt
import os, sys, json, collections
from datetime import datetime
import numpy as np, pandas as pd
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, engine, strat, runs
from engine import P

AGES = (0, 1, 2, 3, 5, 7)
K = 12                                   # live-prep's max_markets since Addendum 19 (the budget binds first)
CREATED = json.load(open(os.environ['Q2AGE_CREATED']))

def ep(s):
    return datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp()

def ages(df):
    """Each market-day's age at its 00:00 UTC, in days, from `createdAt` (NaN where Gamma gave none)."""
    out = []
    for c, d in zip(df.cond, df.day):
        cr = CREATED.get(c)
        out.append((ep(d + 'T00:00:00+00:00') - ep(cr)) / 86400 if cr else np.nan)
    return np.array(out)

def q2_eligible(day_df, min_age):
    x = strat.eligible(day_df, min_width_c=4, max_api_vol=50)
    if min_age:
        a = ages(x)
        x = x[~np.isnan(a) & (a >= min_age)]
    return x

def sel_q2(min_age, eq):
    budget = 0.9 * runs.cap_of(eq)
    def f(day_df):
        x = q2_eligible(day_df, min_age)
        return strat.choose(x, x.est0 / x.cap0, budget, K)
    return f

def run_one(args):
    min_age, days, eq, span = args
    cap = runs.cap_of(eq)
    pol = P(name=f'Q2 + age >= {min_age} d', cap_total=cap, cap_market=min(100.0, cap), min_width_c=4, place='inside', k=0, inv_cap=2)
    sch = strat.schedule(sel_q2(min_age, eq), days)
    o, res = strat.price(pol, sch, days, label=f'Q2 + age >= {min_age} d [{span}] ${eq:.0f}' if min_age else f'Q2 (no age filter) [{span}] ${eq:.0f}')
    o['min_age'] = min_age; o['span'] = span; o['eq'] = eq
    # what it picked, each day: how many quiet books there were, how many it took, the capital they asked
    df = strat.daytable()
    starve = {}
    for d in days:
        x = q2_eligible(df[df.day == d], min_age)
        picks = sch[d]
        capd = float(x[x.mid.isin([m for m, _, _ in picks])].cap0.sum())
        starve[d] = (len(x), len(picks), round(capd, 2))
    o['starve'] = starve
    # each market-day's total (rewards + rebates + the fills' change), with the market's age that day, for the mechanism
    agemap = dict(zip(zip(df.mid.astype(int), df.day), ages(df)))
    o['mdays'] = [[int(k.split('|')[0]), k.split('|')[1], round(pay + reb + dm, 6), round(pay, 6), round(dm, 6)] for k, (pay, reb, dm) in res['md'].items()]
    o['mdays_age'] = [agemap.get((m, d)) for m, d, *_ in o['mdays']]
    return o

if __name__ == '__main__':
    df = strat.daytable()
    print(f"Q2-AGE: Q2 (quiet <= 50 sh/24 h by the data API, touch >= 4 c, RW's price, N, 2N, {K} markets inside 90 % of the cap) "
          f"with and without a minimum age by Gamma's createdAt. R {engine.calib()['R_engine']:.3f} (engine units), k_vol {engine.calib()['k_vol']:.3f}")
    miss = int(np.isnan(ages(df)).sum())
    print(f"market-days without a createdAt: {miss} of {len(df)}")
    jobs = [(a, days, eq, span) for eq in (316.0, 400.0) for a in AGES for span, days in (('TRAIN', strat.TRAIN), ('TEST', strat.TEST), ('ALL', strat.DAYS))]
    with Pool(4) as pool: outs = pool.map(run_one, jobs, chunksize=1)
    by = {(o['eq'], o['min_age'], o['span']): o for o in outs}
    for eq in (316.0, 400.0):
        print(f"\n== equity ${eq:.0f} (cap ${runs.cap_of(eq):.0f}, budget ${0.9 * runs.cap_of(eq):.0f}); $ a day [5 %, 95 % over market-days]")
        for span in ('TRAIN', 'TEST', 'ALL'):
            for a in AGES: print(strat.fmt(by[(eq, a, span)]))
        tr = sorted(AGES, key=lambda a: -by[(eq, a, 'TRAIN')]['lo'])
        print(f"   chosen on TRAIN by the 5 % bound: min age {tr[0]} d (then {tr[1:]}); by the mean: {max(AGES, key=lambda a: by[(eq, a, 'TRAIN')]['per_day'])} d")
        print(f"   TEST for the choice: {by[(eq, tr[0], 'TEST')]['per_day']:+.2f} [{by[(eq, tr[0], 'TEST')]['lo']:+.2f}, {by[(eq, tr[0], 'TEST')]['hi']:+.2f}]"
              f" against Q2's {by[(eq, 0, 'TEST')]['per_day']:+.2f} [{by[(eq, 0, 'TEST')]['lo']:+.2f}, {by[(eq, 0, 'TEST')]['hi']:+.2f}]")
        print("   days, ALL (per day: total; quiet books / picks / first-quote capital of the picks):")
        for a in AGES:
            o = by[(eq, a, 'ALL')]
            cells = '  '.join(f"{d[5:]} {o['daily'].get(d, 0):+6.2f} {o['starve'][d][0]:>3}/{o['starve'][d][1]:>2}/${o['starve'][d][2]:>5.0f}" for d in strat.DAYS)
            print(f"   >= {a} d: {cells}")
    # The mechanism: Q2's own market-days on the whole span at $316, by the market's age that day.
    o = by[(316.0, 0, 'ALL')]
    print("\n== Q2's own market-days (whole span, $316) by age at 00:00: $ in all (rewards; the fills' change) and a market-day")
    for a0, a1, name in ((0, 1, 'under 1 day'), (1, 3, '1-3 days'), (3, 7, '3-7 days'), (7, 30, '7-30 days'), (30, 1e9, '30 days +')):
        rs = [m for m, a in zip(o['mdays'], o['mdays_age']) if a is not None and a0 <= a < a1]
        if rs:
            t, p, f = sum(r[2] for r in rs), sum(r[3] for r in rs), sum(r[4] for r in rs)
            print(f"   {name:<12}{len(rs):>5} market-days  {t:>+8.2f} ({p:>+7.2f}; {f:>+8.2f})  {t / len(rs):>+7.3f}")
    json.dump(outs, open(os.path.join(lib.WORK, 'q2age.json'), 'w'), indent=1, default=str)
