# Q2-PM (2026-10-14), the inputs: LP-BEST's pipeline on a work folder that runs to the archive's last closed hour after
# Q2's first live day (Q2PM_WORK: pm-rec's archive 10-04 19:00 -> 10-14 01:59 through extract.py; LP-BEST's and Q2-AGE's
# folders stay as they were). Three steps, each LP-BEST's own code with its day list set to 2026-10-14:
#   table  the 10-14 day table (daytable.py's `one`), on pm-rec's tape, or with LPBEST_API_TAPE=1 on the data API's
#   tape   the data API's prints 2026-10-12 00:00 -> 10-14 02:00 for every market Q2 could have quoted on 10-13 or 10-14
#          (touch >= 3 c at 00:00 on either day's table) and every market live quoted since the restart (apitape.py's
#          `fetch`, keyless), merged into the folder's prints_api.pkl (a copy of Q2-AGE's)
#   merge  one daytable_api.csv.gz for 10-05 -> 10-14: LP-BEST's 10-05 -> 10-12 rows, Q2-AGE's 10-13 rows, these 10-14 rows
# Order: table (pm-rec tape), tape, LPBEST_API_TAPE=1 table, merge.
#   LPBEST_WORK=<Q2PM_WORK> [LPBEST_API_TAPE=1] Q2PM_LPBEST=<LP-BEST work> Q2PM_AGE13=<Q2-AGE 10-13 work> Q2PM_LIVE=<live_aux.json> \
#     python3 -I docs/agents/backtests/lpbest/scripts/q2pm_data.py table|tape|merge
import os, sys, json, gzip, csv, pickle
import numpy as np, pandas as pd
from multiprocessing import Pool
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, engine, strat, daytable

DAY = '2026-10-14'
daytable.DAYS = [DAY]
daytable.D0 = {DAY: int(pd.Timestamp(DAY, tz='UTC').timestamp()) // 60}

def table():
    ids = daytable.universe_ids()
    kv = engine.calib()['k_vol']
    out = os.path.join(lib.WORK, f'daytable14{lib.TAG}.csv.gz')
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
    T0, T1 = int(pd.Timestamp('2026-10-12T00:00:00Z').timestamp()), int(pd.Timestamp('2026-10-14T02:00:00Z').timestamp())
    apitape.T0 = T0
    md = lib.meta()
    by_cond = {m['cond']: i for i, m in md.items()}
    mids = set()
    for p in (os.path.join(os.environ['Q2PM_AGE13'], 'daytable.csv.gz'), os.path.join(lib.WORK, 'daytable14.csv.gz')):
        df = pd.read_csv(p, low_memory=False)
        mids |= set(int(m) for m in strat.eligible(df, min_width_c=3).mid)
    live = json.load(open(os.environ['Q2PM_LIVE']))
    for m in live['markets']:
        if m['cond'] in by_cond: mids.add(by_cond[m['cond']])
    mids = sorted(mids)
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
    capped = [mid for mid, arr, n in res if n >= 10000]
    print(f"{len(mids)} markets asked; {len(mids) - len(failed)} read; {len(failed)} failed; {len(capped)} at the API's 10,000-row reach; "
          f"{sum(len(a) for m, a, n in res if a is not None)} prints in the window")

def merge():
    a = pd.read_csv(os.path.join(os.environ['Q2PM_LPBEST'], 'daytable_api.csv.gz'), low_memory=False)
    b = pd.read_csv(os.path.join(os.environ['Q2PM_AGE13'], 'daytable_api.csv.gz'), low_memory=False)
    c = pd.read_csv(os.path.join(lib.WORK, 'daytable14_api.csv.gz'), low_memory=False)
    a = a[a.day.isin(strat.DAYS)]; b = b[b.day == '2026-10-13']; c = c[c.day == DAY]
    df = pd.concat([a, b, c], ignore_index=True)
    df.to_csv(os.path.join(lib.WORK, 'daytable_api.csv.gz'), index=False, compression='gzip')
    print({d: int((df.day == d).sum()) for d in sorted(df.day.unique())})

if __name__ == '__main__':
    {'table': table, 'tape': tape, 'merge': merge}[sys.argv[1]]()
