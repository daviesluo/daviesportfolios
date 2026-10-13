# LP-BEST: turn the pm-rec archive (downloaded by fetch.py into a scratch folder; never committed) into one compact file
# a market for the simulator: every minute's YES book (the best 8 levels each side, within RW's 10 c of the touch, as
# pm-rec recorded them), every taker print, and the programme the listing read every 15 minutes.
#   python3 -I docs/agents/backtests/lpbest/scripts/extract.py <pmrec dir> <pmrec universe dir> <out dir>
# Kept: every market of the books set whose minimum size was 50 or less on some day's dump (N <= 50).
# Out: <out>/mk/<id>.npz {m: epoch minute, tick, bp/bs/ap/as: 8 levels (price 1e-4 int16, size float32; 0 = none)},
#      <out>/prints.pkl {id: array (ts, dir, ypx, size)} where dir +1 is a taker BUY of YES (it lifts asks), -1 a SELL,
#      <out>/prog.pkl {id: array (epoch minute, rate, v, min_size)} from the universe lines, and <out>/meta.json from the
#      daily dumps (question, end date, neg-risk, fee type, event, category, and each day's programme).
import gzip, json, os, sys, glob, pickle
import numpy as np
from multiprocessing import Pool
from datetime import datetime

src, usrc, out = sys.argv[1], sys.argv[2], sys.argv[3]
K = 8
os.makedirs(os.path.join(out, 'mk'), exist_ok=True)

def ep(iso):
    return int(datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp())

# --- the daily dumps: static metadata and each day's programme
meta = {}
for p in sorted(glob.glob(os.path.join(src, 'markets_*.gz'))):
    day = None
    with gzip.open(p, 'rt') as f:
        for line in f:
            d = json.loads(line)
            if 'kind' in d: day = d['day']; continue
            m = meta.setdefault(d['id'], {'cond': d['cond'], 'q': d['question'], 'end': d['end_date'], 'gs': d['game_start'],
                                          'neg': d['neg_risk'], 'fee': d['fee_type'], 'ev': d['event_slug'], 'cat': d['category'], 'days': {}})
            m['end'] = d['end_date'] or m['end']; m['gs'] = d['game_start'] or m['gs']
            m['days'][day] = [d['rate'], d['max_spread'], d['min_size'], d['volume24hr'], d['closed'], d['accepting']]
keep = {i for i, m in meta.items() if any(v[2] is not None and v[2] <= 50 for v in m['days'].values())}

def books(path):
    rows = {}
    minute = None
    with gzip.open(path, 'rt') as f:
        for line in f:
            if line[0] == '{':
                minute = ep(json.loads(line)['minute']) // 60; continue
            x = json.loads(line)
            i = x[0]
            if i not in keep: continue
            _, dt, tick, bp, bs, ap, asz, ab, aa, ltp = x
            r = rows.setdefault(i, [])
            r.append((minute, tick or 0, bp[:K], bs[:K], ap[:K], asz[:K]))
    outd = {}
    for i, r in rows.items():
        n = len(r)
        mm = np.array([a[0] for a in r], np.int32); tk = np.array([a[1] for a in r], np.int16)
        BP = np.zeros((n, K), np.int16); BS = np.zeros((n, K), np.float32); AP = np.zeros((n, K), np.int16); AS = np.zeros((n, K), np.float32)
        for j, a in enumerate(r):
            BP[j, :len(a[2])] = a[2]; BS[j, :len(a[3])] = np.array(a[3]) / 100
            AP[j, :len(a[4])] = a[4]; AS[j, :len(a[5])] = np.array(a[5]) / 100
        outd[i] = (mm, tk, BP, BS, AP, AS)
    return outd

def prints(path):
    out = []
    with gzip.open(path, 'rt') as f:
        for line in f:
            if line[0] == '{': continue
            i, ts, side, oi, price, size = json.loads(line)
            if i not in keep or oi not in (0, 1) or price is None or size is None: continue
            buy = (side == 'BUY')
            if oi == 1: buy = not buy; price = 1 - price
            out.append((i, ts, 1 if buy else -1, price, size))
    return out

def universe(path):
    out, frames = [], []
    minute = None
    with gzip.open(path, 'rt') as f:
        for line in f:
            if line[0] == '{':
                h = json.loads(line); minute = ep(h['minute']) // 60
                frames.append((minute, h.get('phase'), h.get('phases'), (h.get('cut') or 0))); continue
            x = json.loads(line)
            if x[0] in keep: out.append((x[0], minute, x[2], x[3], x[4]))
    return out, frames

if __name__ == '__main__':
    bfiles = sorted(glob.glob(os.path.join(src, 'books_*.gz')))
    acc = {}
    with Pool(4) as pool:
        for d in pool.imap(books, bfiles, chunksize=1):
            for i, v in d.items(): acc.setdefault(i, []).append(v)
    nrows = 0
    for i, parts in acc.items():
        arrs = [np.concatenate([p[k] for p in parts]) for k in range(6)]
        o = np.argsort(arrs[0], kind='stable')
        arrs = [a[o] for a in arrs]
        _, u = np.unique(arrs[0], return_index=True)
        arrs = [a[u] for a in arrs]
        nrows += len(arrs[0])
        np.savez(os.path.join(out, 'mk', f'{i}.npz'), m=arrs[0], tick=arrs[1], bp=arrs[2], bs=arrs[3], ap=arrs[4], as_=arrs[5])
    pfiles = sorted(glob.glob(os.path.join(src, 'prints_*.gz')))
    P = {}
    with Pool(4) as pool:
        for lst in pool.imap(prints, pfiles, chunksize=4):
            for (i, ts, d, y, s) in lst: P.setdefault(i, set()).add((ts, d, y, s))
    P = {i: np.array(sorted(v), np.float64) for i, v in P.items()}
    pickle.dump(P, open(os.path.join(out, 'prints.pkl'), 'wb'), protocol=5)
    ufiles = sorted(glob.glob(os.path.join(usrc, 'universe_*.gz')))
    G, F = {}, []
    with Pool(4) as pool:
        for lst, fr in pool.imap(universe, ufiles, chunksize=4):
            F.extend(fr)
            for (i, mi, r, v, ms) in lst: G.setdefault(i, []).append((mi, r if r is not None else -1, v if v is not None else -1, ms if ms is not None else -1))
    G = {i: np.array(sorted(v), np.float64) for i, v in G.items()}
    pickle.dump({'reads': G, 'frames': sorted(F)}, open(os.path.join(out, 'prog.pkl'), 'wb'), protocol=5)
    json.dump({str(i): meta[i] for i in keep}, open(os.path.join(out, 'meta.json'), 'w'))
    print(len(bfiles), 'books hours;', len(acc), 'markets kept with books;', nrows, 'market-minutes;', len(pfiles), 'prints hours,',
          sum(len(v) for v in P.values()), 'prints;', len(ufiles), 'universe hours,', sum(len(v) for v in G.values()), 'programme reads')
