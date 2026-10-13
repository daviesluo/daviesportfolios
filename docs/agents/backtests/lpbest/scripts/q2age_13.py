# Q2-AGE, the second out-of-sample span (2026-10-13): what pm-rec's archive holds past LP-BEST's eight days, 2026-10-13
# 00:00 -> 12:59 UTC (the archive's last closed hour when this ran; Q2 itself went live at 13:25, after it). LP-BEST's
# pipeline on its own work folder (Q2AGE13_WORK; LP-BEST's stays as frozen): extract.py over every hour to 10-13 12:00,
# then three steps here, each LP-BEST's code with its day list set to 10-13:
#   table  the day table for 10-13 (daytable.py's `one`), on pm-rec's tape (written as daytable.csv.gz)
#   tape   the data API's prints, 2026-10-12 00:00 -> 10-13 13:00, for every market of it with a touch of 3 c or more at
#          00:00 (apitape.py's `fetch`), merged into LP-BEST's prints_api.pkl (a copy in this folder), then the day table
#          again on that tape (daytable_api.csv.gz)
#   run    Q2 and Q2 + a minimum age through the engine, 00:00 -> 12:59, at $316 and $400, by the same selection as q2age.py
# The engine needs LP-BEST's calib.json and validate.json, rec_markets.json.gz, and the live orders to take our own out of
# the books (sql/live_orders.sql's reply as live_orders.json.gz, read again for 10-13).
#   LPBEST_WORK=<Q2AGE13_WORK> [LPBEST_API_TAPE=1] Q2AGE_CREATED=<created.json> python3 -I docs/agents/backtests/lpbest/scripts/q2age_13.py table|tape|run
import os, sys, json, gzip, csv, pickle, time, urllib.request
import numpy as np, pandas as pd
from multiprocessing import Pool
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, engine, strat, daytable

DAY = '2026-10-13'
END = int(pd.Timestamp('2026-10-13T13:00:00Z').timestamp()) // 60 - 1      # the last minute the archive holds
daytable.DAYS = [DAY]
daytable.D0 = {DAY: int(pd.Timestamp(DAY, tz='UTC').timestamp()) // 60}
strat.DAYS = [DAY]; strat.D0[DAY] = daytable.D0[DAY]

def table():
    ids = daytable.universe_ids()
    kv = engine.calib()['k_vol']
    out = os.path.join(lib.WORK, f'daytable{lib.TAG}.csv.gz')
    n = 0
    with Pool(4, initializer=daytable.init, initargs=(kv,)) as pool, gzip.open(out, 'wt', newline='') as f:
        w = None
        for rows in pool.imap_unordered(daytable.one, ids, chunksize=8):
            for r in rows:
                if w is None:
                    w = csv.DictWriter(f, fieldnames=list(r.keys())); w.writeheader()
                w.writerow(r); n += 1
    print(len(ids), 'markets;', n, 'market-days ->', os.path.basename(out))

def tape():
    import apitape
    T0, T1 = int(pd.Timestamp('2026-10-12T00:00:00Z').timestamp()), int(pd.Timestamp('2026-10-13T13:00:00Z').timestamp())
    apitape.T0 = T0
    df = pd.read_csv(os.path.join(lib.WORK, 'daytable.csv.gz'), low_memory=False)
    e = strat.eligible(df, min_width_c=3)
    mids = sorted(set(int(m) for m in e.mid))
    md = lib.meta()
    def one(mid):
        rows = apitape.fetch(md[mid]['cond'])
        if rows is None: return mid, None, 0
        pr = set()
        for r in rows:
            ts = int(r['timestamp'])
            if not (T0 <= ts < T1): continue
            oi = int(r.get('outcomeIndex', 0)); p = float(r['price']); s = float(r['size'])
            buy = r['side'] == 'BUY'
            if oi == 1: buy = not buy; p = 1 - p
            pr.add((ts, 1 if buy else -1, p, s, r.get('transactionHash', '')))
        return mid, np.array(sorted((a, b, c, d) for (a, b, c, d, h) in pr), np.float64).reshape(-1, 4), len(rows)
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(one, mids))
    p = os.path.join(lib.WORK, 'prints_api.pkl')
    old = pickle.load(open(p, 'rb')) if os.path.exists(p) else {}
    for mid, arr, n in res:
        if arr is None: continue
        prev = old.get(mid)
        keep = prev[prev[:, 0] < T0] if prev is not None and len(prev) else np.zeros((0, 4))
        old[mid] = np.vstack([keep, arr]) if len(keep) else arr
    pickle.dump(old, open(p, 'wb'), protocol=5)
    failed = [mid for mid, arr, n in res if arr is None]
    print(f"{len(mids)} markets asked; {len(mids) - len(failed)} read; {len(failed)} failed; {sum(len(a) for m, a, n in res if a is not None)} prints in the window")

def created():
    """Gamma's `createdAt` for every market of the 10-13 table not yet in $Q2AGE_CREATED (a copy of PMOPPS' cache in this
    folder): keyless reads of /markets, fifty conditions a read, open and closed (pool_age.py's own read)."""
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'pmopps', 'scripts'))
    import pmnet
    path = os.environ['Q2AGE_CREATED']
    have = json.load(open(path))
    df = pd.read_csv(os.path.join(lib.WORK, 'daytable_api.csv.gz'), low_memory=False)
    todo = sorted({c for c in df.cond if c not in have})
    for closed in (None, 'true'):
        for i in range(0, len(todo), 50):
            chunk = [c for c in todo[i:i + 50] if c not in have]
            if not chunk: continue
            params = {'condition_ids': chunk, 'limit': 100}
            if closed: params['closed'] = closed
            for m in pmnet.get('https://gamma-api.polymarket.com/markets', params):
                have[m['conditionId']] = m.get('createdAt')
    json.dump(have, open(path, 'w'))
    print(f"{len(todo)} conditions asked; {sum(1 for c in todo if have.get(c))} with a createdAt")

def run():
    import q2age, runs
    from engine import P
    df = strat.daytable()
    print(f"Q2-AGE on 2026-10-13 00:00 -> 12:59 UTC (pm-rec's archive past LP-BEST's span; a partial day). Market-days without a createdAt: "
          f"{int(np.isnan(q2age.ages(df)).sum())} of {len(df)}")
    t0 = strat.D0[DAY]
    for eq in (316.0, 400.0):
        print(f"\n== equity ${eq:.0f}: $ over the 13 hours [5 %, 95 % over market-days], and the day's quiet books / picks / first-quote capital")
        for a in q2age.AGES:
            cap = runs.cap_of(eq)
            pol = P(name=f'age {a}', cap_total=cap, cap_market=min(100.0, cap), min_width_c=4, place='inside', k=0, inv_cap=2)
            x = q2age.q2_eligible(df[df.day == DAY], a)
            picks = q2age.sel_q2(a, eq)(df[df.day == DAY])
            sch = {DAY: [(int(r.mid), i + 1, None) for i, r in enumerate(picks)]}
            res = engine.run(pol, sch, t0, END)
            vals = np.array([pay + reb + dm for (pay, reb, dm) in res['md'].values()]) if res['md'] else np.zeros(0)
            lo = hi = 0.0
            if len(vals):
                rnd = np.random.default_rng(20261013)
                tot = vals[rnd.integers(0, len(vals), size=(2000, len(vals)))].sum(1)
                lo, hi = np.percentile(tot, [5, 95])
            lab = 'Q2 (no age filter)' if not a else f'Q2 + age >= {a} d'
            print(f"  {lab:<20}{res['total']:>+8.2f} [{lo:>+7.2f}, {hi:>+7.2f}]  rewards {res['paid']:>6.2f}  fills {res['fills_pnl']:>+7.2f}  rebates {res['rebate']:>5.2f}"
                  f"  shares {res['shares']:>6.0f}  quiet {len(x):>3} / picks {len(picks):>2} / ${sum(r.cap0 for r in picks):>4.0f}")
            if eq == 316.0 and a in (0, 3):
                ag = dict(zip(df.mid.astype(int), q2age.ages(df)))
                for k, (pay, reb, dm) in sorted(res['md'].items(), key=lambda kv: sum(kv[1])):
                    mid = int(k.split('|')[0])
                    print(f"      {lib.meta()[mid]['cond'][:12]}  age {ag.get(mid, float('nan')):6.2f} d  {pay + reb + dm:+7.2f} (rewards {pay:5.2f}, fills {dm:+7.2f})  {(lib.meta()[mid].get('q') or '')[:60]}")

if __name__ == '__main__':
    {'table': table, 'tape': tape, 'created': created, 'run': run}[sys.argv[1]]()
