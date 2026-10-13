# LP-BEST, step 3: one row per market and UTC day over the pm-rec universe (2026-10-05 -> 10-12), for every market of
# $10 a day or more with a minimum of 50 or less at 00:00 and a recorded book: what was knowable at 00:00 (the
# programme, the book, the last 24 hours' prints and moves, the type, the days to its end) and what a stateless two-sided
# quote of N shares a side would have met that day at five placements (RW's tick inside the touch, at the touch, one,
# two and three ticks behind it): the reward formula it scored, the fills it took (lib.py's rule, x k_vol) and their
# markouts. Stateless: no inventory, no capital, every minute quoted; the engine prices the policies built from it.
#   LPBEST_WORK=<scratch> python3 -I docs/agents/backtests/lpbest/scripts/daytable.py   (writes <work>/daytable.csv.gz)
import os, sys, json, gzip, csv, math
import numpy as np, pandas as pd
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, engine

DAYS = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']
D0 = {d: int(pd.Timestamp(d, tz='UTC').timestamp()) // 60 for d in DAYS}
PLACES = [('inside', 0), ('join', 0), ('behind', 1), ('behind', 2), ('behind', 3)]
KV = None

def universe_ids():
    have = set(lib.market_ids()); out = []
    for i, m in lib.meta().items():
        if i not in have: continue
        if any((v[0] or 0) >= 10 and v[2] is not None and v[2] <= 50 for d, v in m['days'].items() if d in DAYS):
            out.append(i)
    return sorted(out)

def first_after(M, x, k=30):
    j = np.searchsorted(M.t, x)
    for jj in range(j, min(j + k, len(M.t))):
        if not np.isnan(M.mid[jj]): return M.mid[jj]
    return np.nan

def qpos_series(px, same, top):
    """Our queue position each minute when the order stays at one price from minute to minute: the others' size at our
    price when we joined (0 if we were better than the touch), then never more than the level's size since."""
    run = np.r_[0, np.cumsum(~np.isclose(px[1:], px[:-1], equal_nan=False) | np.isnan(px[1:]))]
    start = np.r_[True, run[1:] != run[:-1]]
    base = np.where(top, 0.0, same)
    s = pd.Series(np.where(start, base, same)).groupby(run).cummin().to_numpy()
    return s

def one(mid):
    try:
        M = engine.market(mid)
    except Exception as e:
        return []
    md = M.meta; rows = []
    kv = KV
    n = len(M.t)
    if n < 100: return []
    out_side = {}
    # per placement: prices, scores, the formula a minute, and the fills a minute
    G = M.groups
    pm = sorted(G)
    pm_idx = np.array([M.index.get(t, -1) for t in pm])
    res = {}
    for (how, k) in PLACES:
        b, a = M.placed(how, k)
        N = M.Nmin
        q1, q2 = M.score(b, a, N, N)
        two = np.minimum(q1, q2)
        rate = np.nan_to_num(M.rate)
        f2 = np.where(two > 0, rate / 1440 * two / (two + M.others), 0.0)
        wide = M.width_t >= 2 - 1e-9
        fills = np.zeros(n); mo60 = np.zeros(n); mo240 = np.zeros(n); edge = np.zeros(n); sweeps = np.zeros(n)
        for side, px in ((1, b), (-1, a)):
            if side == 1:
                top = np.isnan(M.bb) | (px > M.bb + 1e-9)
                same = np.nansum(np.where(np.abs(M.bp - px[:, None]) < 1e-9, M.bs, 0), 1)
                ahead = np.nansum(np.where(M.bp > px[:, None] + 1e-9, M.bs, 0), 1)
            else:
                top = np.isnan(M.ba) | (px < M.ba - 1e-9)
                same = np.nansum(np.where(np.abs(M.ap - px[:, None]) < 1e-9, M.as_, 0), 1)
                ahead = np.nansum(np.where(M.ap < px[:, None] - 1e-9, M.as_, 0), 1)
            qp = qpos_series(px, same, top)
            D = np.where(top, 0.0, ahead + qp)
            want = -1 if side == 1 else 1
            for t, i in zip(pm, pm_idx):
                if i < 0 or np.isnan(px[i]): continue
                left = N[i]; used = 0.0; p = px[i]
                for (ts, dd, y, s) in G[t]:
                    if dd != want or left <= 1e-9: continue
                    if (side == 1 and y > p + 1e-9) or (side == -1 and y < p - 1e-9): continue
                    f = max(0.0, used + s - D[i]) - max(0.0, used - D[i]); used += s
                    f = min(left, f * kv)
                    if f <= 1e-9: continue
                    left -= f
                    fills[i] += f
                    m60 = first_after(M, t + 61); m240 = first_after(M, t + 241)
                    if not np.isnan(m60): mo60[i] += side * (m60 - p) * f
                    if not np.isnan(m240): mo240[i] += side * (m240 - p) * f
                    if not np.isnan(M.mid[i]): edge[i] += side * (M.mid[i] - p) * f
                    if not top[i]: sweeps[i] += f
        res[(how, k)] = (f2, wide, fills, mo60, mo240, edge, sweeps)
    # taker toxicity over the whole record: each print's 60-minute markout to the taker, by minute
    tox = np.zeros(n); tvol = np.zeros(n); nprint = np.zeros(n)
    for t, i in zip(pm, pm_idx):
        if i < 0: continue
        m60 = first_after(M, t + 61)
        for (ts, dd, y, s) in G[t]:
            nprint[i] += 1; tvol[i] += s
            if not np.isnan(m60): tox[i] += dd * (m60 - y) * s
    dmid = np.abs(np.diff(M.mid, prepend=np.nan)) * 100
    for d in DAYS:
        d0 = D0[d]
        i0 = np.searchsorted(M.t, d0); i1 = np.searchsorted(M.t, d0 + 1440)
        if i1 - i0 < 60 or i0 >= n: continue
        j = i0
        while j < min(i0 + 10, n) and (np.isnan(M.m[j]) or np.isnan(M.v[j])): j += 1
        if j >= n or np.isnan(M.m[j]) or M.t[j] > d0 + 10: continue
        rate0, v0, ms0 = M.rate[j], M.v[j], M.ms[j]
        if not (rate0 >= 10 and ms0 <= 50): continue
        p0 = np.searchsorted(M.t, d0 - 1440)
        sl = slice(p0, i0)
        bi, ai = M.placed('inside')
        N0 = max(ms0, 5)
        db, da = (M.m[j] - bi[j]) * 100, (ai[j] - M.m[j]) * 100
        s1 = ((v0 - db) / v0) ** 2 * N0 if 0 <= db < v0 else 0.0
        s2 = ((v0 - da) / v0) ** 2 * N0 if 0 <= da < v0 else 0.0
        ours0 = min(s1, s2) if not (np.isnan(s1) or np.isnan(s2)) else 0.0
        est0 = rate0 * ours0 / (ours0 + M.others[j]) if ours0 > 0 else 0.0
        cap0 = N0 * (bi[j] + 1 - ai[j]) if not np.isnan(bi[j]) else np.nan
        end = md.get('end'); gs = md.get('gs')
        dte = (pd.Timestamp(end).timestamp() / 60 - d0) / 1440 if end else np.nan
        row = dict(mid=mid, cond=M.cond, day=d, type=M.type, lptype=M.lptype, fee=md.get('fee'), neg=md.get('neg'), q=(M.q or '')[:90],
                   rate0=rate0, v0=v0, ms0=ms0, N=N0, tick0=M.tick[j], mid0=M.mid[j], m0=M.m[j], width0_t=M.width_t[j], width0_c=M.width_c[j],
                   others0=M.others[j], est0=est0, cap0=cap0, dte=dte, gs=gs or '',
                   p_minutes=i0 - p0, p_prints=nprint[sl].sum(), p_vol=tvol[sl].sum(), p_tox=tox[sl].sum(),
                   p_range=(np.nanmax(M.mid[sl]) - np.nanmin(M.mid[sl])) * 100 if i0 > p0 and np.isfinite(M.mid[sl]).any() else np.nan,
                   p_absmove=np.nansum(dmid[sl]), p_tight=float(np.nanmean(M.width_t[sl] < 2)) if i0 > p0 else np.nan,
                   p_width=float(np.nanmean(M.width_c[sl])) if i0 > p0 else np.nan,
                   minutes=i1 - i0, d_prints=nprint[i0:i1].sum(), d_vol=tvol[i0:i1].sum(), d_tox=tox[i0:i1].sum(),
                   d_range=(np.nanmax(M.mid[i0:i1]) - np.nanmin(M.mid[i0:i1])) * 100 if np.isfinite(M.mid[i0:i1]).any() else np.nan,
                   d_rate_mean=float(np.nanmean(M.rate[i0:i1])), d_rate_out=float(np.nanmean(np.nan_to_num(M.rate[i0:i1]) < 10)))
        for (how, k), (f2, wide, fills, mo60, mo240, edge, sweeps) in res.items():
            tag = how if how != 'behind' else f'behind{k}'
            w = wide[i0:i1]
            row[f'{tag}_f2'] = f2[i0:i1].sum(); row[f'{tag}_f2w'] = f2[i0:i1][w].sum()
            row[f'{tag}_sh'] = fills[i0:i1].sum(); row[f'{tag}_shw'] = fills[i0:i1][w].sum()
            row[f'{tag}_mo60'] = mo60[i0:i1].sum(); row[f'{tag}_mo60w'] = mo60[i0:i1][w].sum()
            row[f'{tag}_mo240'] = mo240[i0:i1].sum(); row[f'{tag}_edge'] = edge[i0:i1].sum()
        rows.append(row)
    engine._MK.pop(mid, None)
    return rows

def init(kv):
    global KV
    KV = kv

if __name__ == '__main__':
    ids = universe_ids()
    kv = engine.calib()['k_vol']
    out = os.path.join(lib.WORK, f'daytable{lib.TAG}.csv.gz')
    n = 0
    with Pool(4, initializer=init, initargs=(kv,)) as pool, gzip.open(out, 'wt', newline='') as f:
        w = None
        for rows in pool.imap_unordered(one, ids, chunksize=8):
            for r in rows:
                if w is None:
                    w = csv.DictWriter(f, fieldnames=list(r.keys())); w.writeheader()
                w.writerow(r); n += 1
    print(len(ids), 'markets;', n, 'market-days ->', out)
