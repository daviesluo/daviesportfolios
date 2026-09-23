"""T3 of prereg_binance_lst_wicks.md (frozen 2026-09-23T14:30:14Z, sha256 89f3f450...).

Resting bids 0.5 / 1 / 2 % under a Binance liquid-staking token's trailing ratio to its base, sold back at
the ratio; 1-minute trade-built klines; an order placed at the turn of minute m fills from minute m+1.
usage: python3 t3_binance_lst_wicks.py [--out results/t3.json]
"""
import bisect, collections, datetime, hashlib, json, os, random, sys

S = (__import__('os').environ.get('FP_ROOT', '.') + '/research_fp2')
RUNGS = (0.005, 0.01, 0.02)
USD = 100.0
HALF_SPREAD = {'WBETHUSDT': 2e-4, 'BNSOLUSDT': 4e-4}
INPUTS = {}

def sha(fn):
    h = hashlib.sha256()
    with open(fn, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()

def load(fn):
    INPUTS[os.path.relpath(fn, S)] = sha(fn)
    return {r[0]: r for r in json.load(open(fn))}

def prepare(lst_fn, base_fn, start, end):
    L = load(lst_fn); B = load(base_fn)
    t0 = int(datetime.datetime.fromisoformat(start).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
    t1 = int(datetime.datetime.fromisoformat(end).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
    ts = sorted(t for t in L if t in B and t0 - 2 * 86400000 <= t < t1)
    # fair for the turn at the START of minute ts[i+1]: ratio over the previous 1,440 minutes (>= 720 present)
    fair = {}
    win = collections.deque(); srt = []
    for i, t in enumerate(ts):
        r = L[t][4] / B[t][4]
        win.append((t, r)); bisect.insort(srt, r)
        while win and win[0][0] <= t - 1440 * 60000:
            _, x = win.popleft(); srt.pop(bisect.bisect_left(srt, x))
        if len(srt) >= 720:
            fair[t] = srt[len(srt) // 2] * B[t][4]     # fair LST price for the turn after minute t
    ts = [t for t in ts if t >= t0]
    return L, ts, fair

def run(sym, L, ts, fair, fee, extra, rng_twins=None, trips_for_null=None):
    """Returns list of trips. Each rung: state flat(bid, placed) / long(qty, entry, entry_i, ask, placed)."""
    hs = HALF_SPREAD[sym]
    state = {k: {'mode': 'flat', 'px': None, 'placed': None} for k in RUNGS}
    trips = []
    for i, t in enumerate(ts):
        lo = L[t][3]; hi = L[t][2]; cl = L[t][4]; qv = L[t][6]
        # a) fills in minute i (orders placed at a turn index <= i, i.e. at the start of minute i or before -> live from i+1;
        #    we store placed = index of the minute AFTER which the order was set, so live when placed < i)
        for k in RUNGS:
            s = state[k]
            if s['px'] is None or s['placed'] is None or s['placed'] >= i:
                continue
            if s['mode'] == 'flat' and lo < s['px'] * (1 - extra):
                qty = USD / s['px']
                state[k] = {'mode': 'long', 'qty': qty, 'entry': s['px'], 'entry_i': i, 'entry_t': t, 'px': None, 'placed': None,
                            'cap': min(1.0, 0.1 * qv / USD)}
            elif s['mode'] == 'long' and hi > s['px'] * (1 + extra):
                pnl = s['qty'] * (s['px'] * (1 - fee) - s['entry'] * (1 + fee))
                trips.append({'rung': k, 'entry_t': s['entry_t'], 'exit_t': t, 'entry': s['entry'], 'exit': s['px'], 'kind': 'maker',
                              'pnl': pnl, 'pnl_cap': pnl * s['cap']})
                state[k] = {'mode': 'flat', 'px': None, 'placed': None}
        # b) the turn at the start of minute i+1
        f = fair.get(t)
        for k in RUNGS:
            s = state[k]
            if s['mode'] == 'long' and i - s['entry_i'] >= 1440:
                px = cl * (1 - hs)
                pnl = s['qty'] * (px * (1 - fee) - s['entry'] * (1 + fee))
                trips.append({'rung': k, 'entry_t': s['entry_t'], 'exit_t': t, 'entry': s['entry'], 'exit': px, 'kind': 'time',
                              'pnl': pnl, 'pnl_cap': pnl * s['cap']})
                state[k] = {'mode': 'flat', 'px': None, 'placed': None}
                s = state[k]
            if f is None:
                continue
            target = f * (1 - k) if s['mode'] == 'flat' else f
            if s['px'] is None or abs(target / s['px'] - 1) > 5e-4:
                s['px'] = target; s['placed'] = i
    return trips

def twin_exit(L, ts, fair, i0, fee, hs, memo):
    """Exit of a position opened at the close of minute i0: ask at fair re-priced by the same rule."""
    if i0 in memo:
        return memo[i0]
    px = None; placed = None; out = None
    for i in range(i0, min(len(ts), i0 + 1442)):
        t = ts[i]
        if px is not None and placed is not None and placed < i and L[t][2] > px:   # fills from the minute after it was set
            out = px; break
        if i - i0 >= 1440:
            out = L[t][4] * (1 - hs); break
        f = fair.get(t)
        if f is not None and (px is None or abs(f / px - 1) > 5e-4):
            px = f; placed = i
    if out is None:
        out = L[ts[min(len(ts) - 1, i0)]][4] * (1 - hs)
    memo[i0] = out
    return out

def summarize(trips, months_days):
    pnl = sum(x['pnl'] for x in trips)
    bym = collections.defaultdict(float)
    for x in trips:
        bym[datetime.datetime.utcfromtimestamp(x['entry_t'] / 1000).strftime('%Y-%m')] += x['pnl']
    byr = collections.defaultdict(lambda: [0, 0.0])
    for x in trips:
        byr[str(x['rung'])][0] += 1; byr[str(x['rung'])][1] += x['pnl']
    return {'pnl': round(pnl, 4), 'round_trips': len(trips), 'won': round(sum(1 for x in trips if x['pnl'] > 0) / len(trips), 3) if trips else None,
            'worst': round(min((x['pnl'] for x in trips), default=0), 4), 'kinds': dict(collections.Counter(x['kind'] for x in trips)),
            'by_rung': {k: {'n': v[0], 'pnl': round(v[1], 4)} for k, v in sorted(byr.items())},
            'by_month': {k: round(v, 4) for k, v in sorted(bym.items())},
            'without_best_month': round(pnl - max(bym.values()), 4) if bym else None,
            'pnl_capacity_arm': round(sum(x['pnl_cap'] for x in trips), 4),
            'return_on_locked_300_per_year_pct': round(pnl / 300.0 / (months_days / 365.0) * 100, 3) if months_days else None}

def main():
    outfn = S + '/results/t3.json'
    if '--out' in sys.argv:
        outfn = sys.argv[sys.argv.index('--out') + 1]
    res = {'prereg': 'prereg_binance_lst_wicks.md', 'prereg_sha256': open(S + '/prereg_binance_lst_wicks.sha256').read().split()[0], 'windows': {}}
    windows = [('primary_WBETH_2023-06_2024-09', 'WBETHUSDT', S + '/data/binance_lst_early/WBETHUSDT_1m.json', S + '/data/binance_lst_early/ETHUSDT_1m.json', '2023-06-01', '2024-10-01'),
               ('confirm_WBETH_2024-10_2026-09', 'WBETHUSDT', S + '/data/binance_lst/WBETHUSDT_1m.json', S + '/data/binance_lst/ETHUSDT_1m.json', '2024-10-01', '2026-09-23'),
               ('confirm_BNSOL_2024-10_2026-09', 'BNSOLUSDT', S + '/data/binance_lst/BNSOLUSDT_1m.json', S + '/data/binance_lst/SOLUSDT_1m.json', '2024-10-01', '2026-09-23')]
    for name, sym, lf, bf, a, b in windows:
        L, ts, fair = prepare(lf, bf, a, b)
        days = (ts[-1] - ts[0]) / 86400000 if ts else 0
        prim = run(sym, L, ts, fair, 0.001, 0.0)
        stress = run(sym, L, ts, fair, 0.002, 1e-4)
        w = {'symbol': sym, 'from': a, 'to': b, 'minutes': len(ts), 'days': round(days, 2),
             'primary': summarize(prim, days), 'stress': summarize(stress, days)}
        if name.startswith('primary'):
            rng = random.Random(20260923)
            valid = [i for i, t in enumerate(ts) if t in fair and i + 1 < len(ts)]
            memo = {}; hs = HALF_SPREAD[sym]
            tots = []
            for _ in range(2000):
                tot = 0.0
                for x in prim:
                    i0 = valid[rng.randrange(len(valid))]
                    ent = L[ts[i0]][4]; qty = USD / ent
                    ex = twin_exit(L, ts, fair, i0, 0.001, hs, memo)   # ask set at the turn after minute i0, live from i0+1, as for a real fill
                    tot += qty * (ex * (1 - 0.001) - ent * (1 + 0.001))
                tots.append(tot)
            tots.sort()
            w['null'] = {'draws': 2000, 'mean': round(sum(tots) / 2000, 4), 'p95': round(tots[1900], 4), 'p05': round(tots[100], 4)}
            p = w['primary']; s = w['stress']
            w['bar'] = {'1_pnl_positive': p['pnl'] > 0, '2_beats_null_p95': p['pnl'] > w['null']['p95'], '3_stress_positive': s['pnl'] > 0,
                        '4_min_30_round_trips': p['round_trips'] >= 30, '5_without_best_month_positive': (p['without_best_month'] or 0) > 0}
            w['passes'] = all(w['bar'].values())
        res['windows'][name] = w
        print(name, 'days', round(days), 'primary', {k: w['primary'][k] for k in ('pnl', 'round_trips', 'won', 'worst', 'kinds', 'by_rung', 'without_best_month', 'pnl_capacity_arm', 'return_on_locked_300_per_year_pct')},
              '| stress', w['stress']['pnl'], '| null', w.get('null'), '| PASSES' if w.get('passes') else ('| FAILS' if 'passes' in w else ''))
    res['inputs_sha256'] = dict(sorted(INPUTS.items()))
    json.dump(res, open(outfn, 'w'), indent=1, sort_keys=True)
    print('wrote', outfn)

if __name__ == '__main__':
    main()
