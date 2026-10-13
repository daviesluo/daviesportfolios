# LP-BEST: selection rules and the runner every strategy goes through. A strategy is a selection (which markets each
# UTC day, from what was knowable at 00:00: daytable.py's features) and a policy (engine.P: how they are quoted, held,
# exited and funded). `price` runs it through the engine and returns the numbers the report quotes, with a market-day
# bootstrap.
import os, sys, json, math, collections
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, engine

DAYS = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']
TRAIN = DAYS[:4]; TEST = DAYS[4:]
D0 = {d: int(pd.Timestamp(d, tz='UTC').timestamp()) // 60 for d in DAYS}
_DT = None

def daytable():
    global _DT
    if _DT is None:
        df = pd.read_csv(os.path.join(lib.WORK, f'daytable{lib.TAG}.csv.gz'), low_memory=False)
        df['tox_rate'] = df['p_tox'] / df['p_vol'].where(df['p_vol'] > 0)
        # the market's own previous UTC day at each placement (knowable at 00:00): its formula, fills and marks
        df = df.sort_values(['mid', 'day'])
        prev = df.groupby('mid').shift(1)
        same_prev = (pd.to_datetime(df.day) - pd.to_datetime(prev.day)).dt.days == 1
        for p in ('inside', 'join', 'behind1', 'behind2', 'behind3'):
            for c in ('f2w', 'shw', 'mo240', 'mo60w'):
                df[f'lag_{p}_{c}'] = prev[f'{p}_{c}'].where(same_prev)
        df['share'] = df.est0 / df.rate0
        # Gamma's 24-hour volume ($) as the day's 00:05 dump read it: what a live selection can read (it reads Gamma)
        md = lib.meta()
        df['g_vol'] = [((md.get(int(m), {}).get('days', {}).get(d) or [None] * 4)[3]) for m, d in zip(df.mid, df.day)]
        # the prior 24 hours' taker volume from Polymarket's data API (apitape.py), every print whether or not pm-rec
        # recorded the market's book that minute: what "quiet" means to a live path that reads the API (NaN: not read)
        pa = os.path.join(lib.WORK, 'prints_api.pkl')
        if os.path.exists(pa):
            import pickle
            A = pickle.load(open(pa, 'rb'))
            vals = []
            for m, d in zip(df.mid, df.day):
                x = A.get(int(m))
                if x is None: vals.append(np.nan); continue
                t0 = D0.get(d, int(pd.Timestamp(d, tz='UTC').timestamp()) // 60) * 60
                sel = (x[:, 0] >= t0 - 86400) & (x[:, 0] < t0)
                vals.append(float(x[sel, 3].sum()))
            df['p_vol_api'] = vals
        else:
            df['p_vol_api'] = np.nan
        df['p_recorded'] = df.p_minutes / 1440
        _DT = df.reset_index(drop=True)
    return _DT

def eligible(df, max_n=20, min_rate=10, exclude_types=(), exclude_lptypes=('AI',), min_dte=None, max_dte=None,
             min_width_t=None, min_width_c=None, max_p_range=None, max_p_vol=None, game_soon=True, weather=False,
             neg_risk=None, only_types=(), max_g_vol=None, max_api_vol=None, min_est=None):
    x = df[(df.N <= max_n) & (df.rate0 >= min_rate) & df.est0.notna() & (df.est0 > 0) & df.cap0.notna() & (df.cap0 > 0)]
    if not weather: x = x[~x.fee.fillna('').str.contains('weather')]
    if exclude_types: x = x[~x.type.isin(exclude_types)]
    if exclude_lptypes: x = x[~x.lptype.isin(exclude_lptypes)]
    if min_dte is not None: x = x[x.dte.isna() | (x.dte >= min_dte)]
    if max_dte is not None: x = x[x.dte.notna() & (x.dte <= max_dte)]
    if game_soon:   # RW-E's 48-hour game-start horizon and its same-day rule: no market whose game starts within two days
        gs = pd.to_datetime(x.gs.replace('', np.nan), utc=True, errors='coerce', format='mixed')
        d0 = pd.to_datetime(x.day, utc=True)
        x = x[gs.isna() | ((gs - d0).dt.total_seconds() / 86400 > 2)]
        x = x[x.dte.isna() | (x.dte > 1)]
    if min_width_t is not None: x = x[x.width0_t >= min_width_t]
    if min_width_c is not None: x = x[x.width0_c >= min_width_c]
    if max_p_range is not None: x = x[x.p_range.notna() & (x.p_range < max_p_range)]
    if max_p_vol is not None: x = x[x.p_vol <= max_p_vol]
    if max_g_vol is not None: x = x[x.g_vol.notna() & (x.g_vol <= max_g_vol)]
    if max_api_vol is not None: x = x[x.p_vol_api.notna() & (x.p_vol_api <= max_api_vol)]
    if min_est is not None: x = x[x.est0 >= min_est]
    if neg_risk is not None: x = x[(x.neg.astype(str).str.lower() == 'true') == neg_risk]
    if only_types: x = x[x.type.isin(only_types)]
    return x

def choose(x, score, budget, k_max, size_mult=1.0):
    """RW's `choose`: rank by score, then whole markets in that order inside the first-quote budget, k_max at most."""
    x = x.assign(score=score).sort_values(['score', 'cond'], ascending=[False, True])
    out, used = [], 0.0
    for r in x.itertuples():
        if not (r.score > 0): break
        c = r.cap0 * size_mult
        if used + c <= budget + 1e-9:
            out.append(r); used += c
            if len(out) >= k_max: break
    return out

def schedule(sel_fn, days=DAYS):
    df = daytable()
    sched = {}
    for d in days:
        rows = sel_fn(df[df.day == d])
        sched[d] = [(int(r.mid), i + 1, None) for i, r in enumerate(rows)]
    return sched

def price(policy, sched, days=DAYS, label=None, nboot=2000):
    t0 = D0[days[0]]; t1 = D0[days[-1]] + 1439
    res = engine.run(policy, sched, t0, t1)
    md = res['md']
    # market-day totals (rewards + rebates + the day's change of the fills mark) for the bootstrap
    vals = collections.defaultdict(float)
    for k, (pay, reb, dm) in md.items():
        vals[k] += pay + reb + dm
    arr = np.array(list(vals.values()))
    nd = len(days)
    lo = mi = hi = 0.0
    if len(arr):
        rnd = np.random.default_rng(20261013)
        s = rnd.integers(0, len(arr), size=(nboot, len(arr)))
        tot = arr[s].sum(1) / nd
        lo, mi, hi = np.percentile(tot, [5, 50, 95])
    daily = res['daily']
    dtot = [daily[d]['total'] for d in days if d in daily]
    out = dict(label=label or policy['name'], days=nd, per_day=res['total'] / nd, lo=lo, hi=hi,
               fills_pnl=res['fills_pnl'] / nd, rewards=res['paid'] / nd, rebates=res['rebate'] / nd, formula2=res['formula2'] / nd,
               fills=res['fills'] / nd, shares=res['shares'] / nd, mo60=res['mo60'] / nd, worst_day=min(dtot) if dtot else 0.0,
               best_day=max(dtot) if dtot else 0.0, peak_held=res['peak_held'], peak_committed=res['peak_committed'],
               markets=len(res['books']), market_days=len(vals), daily={d: round(daily[d]['total'], 2) for d in days if d in daily})
    return out, res

def fmt(o):
    return (f"{o['label']:<58}{o['per_day']:>+8.2f} [{o['lo']:>+7.2f}, {o['hi']:>+7.2f}]  rew {o['rewards']:>6.2f} fills {o['fills_pnl']:>+7.2f} "
            f"reb {o['rebates']:>5.2f}  sh/d {o['shares']:>6.0f} mo60/d {o['mo60']:>+7.2f}  worst {o['worst_day']:>+7.2f}  peak$ {o['peak_committed']:>5.0f}  mkts {o['markets']}")
