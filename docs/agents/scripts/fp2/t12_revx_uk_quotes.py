"""T1 / T2 of prereg_revx_uk_quotes.md (frozen 2026-09-23T14:20:04Z, sha256 e8294ebe...).

Resting 0 % quotes on Revolut X UK USD books, anchored to Binance, one lot at a time, fills only from UK
prints strictly through the price. T1 = inside a wide resident spread on long-tail books (d = 0.5 h,
w = 0.3 h); T2 = far outside it (d = 50 bps, w = 20 bps) waiting for UK-only sweeps.

usage: python3 t12_revx_uk_quotes.py [--is-only] [--out results/t12.json]
  --is-only : simulate in-sample days only (used while writing the code; the bar is judged on OOS)
Deterministic: no clock, no unseeded randomness; inputs hashed into the output.
"""
import bisect, collections, glob, hashlib, json, math, os, random, sys, datetime

S = (__import__('os').environ.get('FP_ROOT', '.') + '/research_fp2')
R = (__import__('os').environ.get('FP_ROOT', '.') + '/research_fp')
CUT = '2026-05-01'
T1_BOOKS = ['C98-USD', 'W-USD', 'CELO-USD', 'AUCTION-USD', 'KAVA-USD', 'ANKR-USD']
T2_BOOKS = ['SUI-USD', 'NEAR-USD', 'FET-USD', 'ICP-USD', 'BCH-USD', 'AVAX-USD']
Q_USD = 200.0
BUDGET_DAY = 800.0
BUCKET_CAP = 40.0
TAKER = 0.0009

def sha(fn):
    h = hashlib.sha256()
    with open(fn, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()

INPUTS = {}
def load_kl(fn):
    INPUTS[os.path.relpath(fn, (__import__('os').environ.get('FP_ROOT', '.') + ''))] = sha(fn)
    return {r[0]: r[4] for r in json.load(open(fn))}

USDC = None
def fair_map(base):
    kfn = S + '/data/binance/%sUSDT_1m.json' % base
    if not os.path.exists(kfn):
        return None
    K = load_kl(kfn)
    F = {}
    for t, c in K.items():
        u = USDC.get(t)
        if u:
            F[t] = c / u          # USD per coin at the END of the minute starting t
    return F

def book_days(book):
    out = []
    for f in sorted(glob.glob(S + '/data/revx_prints/%s/*.json' % book)):
        d = json.load(open(f))
        if not d.get('complete'):
            continue
        INPUTS[os.path.relpath(f, (__import__('os').environ.get('FP_ROOT', '.') + ''))] = sha(f)
        rows = [(r['timestamp'], float(r['price']), float(r['quantity']), r['side']) for r in d['rows']]
        rows.sort()
        out.append((d['day'], rows))
    return out

def h_book_from(days, F):
    v = []
    for day, rows in days:
        for t, p, q, side in rows:
            pm = t // 60000 * 60000 - 60000
            f = F.get(pm)
            if not f:
                continue
            v.append((p / f - 1) * 1e4 if side == 'buy' else (1 - p / f) * 1e4)
    v.sort()
    return (v[len(v) // 2] if v else None), len(v)

def simulate_day(day, rows, F, p):
    """One book-day. p: dict(d_bps, w_bps, tstop_min, stop_bps, lat_s, extra_bps, taker, h_bps).
    Returns (trips, placements, pos_path) where pos_path[minute_index] = base qty held at that minute's start."""
    d0 = int(datetime.datetime.fromisoformat(day).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
    lat = int(p['lat_s'] * 1000)
    d = p['d_bps'] / 1e4; w = p['w_bps'] / 1e4; ex = p['extra_bps'] / 1e4
    ts = [r[0] for r in rows]
    tokens = BUCKET_CAP
    placements = 0
    bid = None      # dict(price, rem, live_from, live_to)
    ask = None
    pos = 0.0; cost = 0.0; entry_t = None; entry_min = None
    trips = []
    path = [0.0] * 1440
    pending_cancel = []  # orders that stay live until the effective time of a cancel
    ip = 0          # next print index
    def crossed_recently(tq, side, target, window_ms):
        """post-only proxy: any `side` print in [tq - window, tq) at or through `target`
        (a buy print at or below a bid we want to place, a sell print at or above an ask)"""
        j = bisect.bisect_left(ts, tq) - 1
        while j >= 0 and rows[j][0] >= tq - window_ms:
            if rows[j][3] == side and ((side == 'buy' and rows[j][1] <= target) or (side == 'sell' and rows[j][1] >= target)):
                return True
            j -= 1
        return False
    def taker_exit(t_eff, f_now):
        j = bisect.bisect_left(ts, t_eff)
        while j < len(rows) and rows[j][0] <= t_eff + 600000:
            if rows[j][3] == 'sell':
                return rows[j][1], rows[j][0]
            j += 1
        return f_now * (1 - p['h_bps'] / 1e4), t_eff
    for mi in range(1440):
        tm = d0 + mi * 60000            # start of minute m (the loop's turn)
        t_eff = tm + lat
        # 1) prints from the previous effective time up to this turn's effective time
        while ip < len(rows) and rows[ip][0] < t_eff:
            t, px, qx, side = rows[ip]; ip += 1
            live = [o for o in pending_cancel if o['live_from'] <= t < o['live_to']]
            if bid is not None and bid['live_from'] <= t:
                live.append(bid)
            if ask is not None and ask['live_from'] <= t:
                live.append(ask)
            for o in live:
                if o['rem'] <= 0:
                    continue
                if o['side'] == 'bid' and side == 'sell' and px < o['price'] * (1 - ex):
                    fq = min(o['rem'], qx)
                    o['rem'] -= fq
                    if pos == 0:
                        entry_t = t; entry_min = mi
                    cost += fq * o['price']; pos += fq
                elif o['side'] == 'ask' and side == 'buy' and px > o['price'] * (1 + ex) and pos > 0:
                    fq = min(o['rem'], qx, pos)
                    o['rem'] -= fq
                    avg = cost / pos
                    trips.append({'day': day, 'entry_t': entry_t, 'exit_t': t, 'qty': fq, 'entry': avg, 'exit': o['price'],
                                  'kind': 'maker', 'pnl': fq * (o['price'] - avg)})
                    cost -= fq * avg; pos -= fq
                    if pos <= 1e-12:
                        pos = 0.0; cost = 0.0
        pending_cancel = [o for o in pending_cancel if o['live_to'] > t_eff]
        path[mi] = pos
        # 2) the turn
        tokens = min(BUCKET_CAP, tokens + BUDGET_DAY / 1440.0)
        f = F.get(tm - 60000)
        if f is None:
            continue
        last = (mi == 1439)
        if pos > 0:
            # a bid left over from the fill is cancelled at this turn
            if bid is not None:
                bid['live_to'] = t_eff; pending_cancel.append(bid); bid = None
            avg = cost / pos
            stop_hit = f <= avg * (1 - p['stop_bps'] / 1e4)
            time_hit = entry_min is not None and (mi - entry_min) >= p['tstop_min']
            if last or stop_hit or time_hit:
                if ask is not None:
                    ask['live_to'] = t_eff; pending_cancel.append(ask); ask = None
                px, tx = taker_exit(t_eff, f)
                proceeds = pos * px * (1 - p['taker'])
                trips.append({'day': day, 'entry_t': entry_t, 'exit_t': tx, 'qty': pos, 'entry': avg, 'exit': px * (1 - p['taker']),
                              'kind': 'eod' if last else ('stop' if stop_hit else 'time'), 'pnl': proceeds - cost})
                pos = 0.0; cost = 0.0; entry_t = None; entry_min = None
                # the rest of this turn: flat, fall through to place a bid (not on the last turn)
                if last:
                    continue
            else:
                target = f * (1 + d)
                need = ask is None or ask['rem'] <= 0 or abs(ask['price'] / f - (1 + d)) > w or abs(ask['rem'] - pos) > 1e-12 * max(1, pos)
                if need:
                    if tokens >= 1:
                        tokens -= 1; placements += 1
                        if ask is not None:
                            ask['live_to'] = t_eff; pending_cancel.append(ask); ask = None
                        if not crossed_recently(tm, 'sell', target, 120000):     # post-only proxy
                            ask = {'side': 'ask', 'price': target, 'rem': pos, 'live_from': t_eff, 'live_to': 10**15}
                continue
        if last:
            if bid is not None:
                bid['live_to'] = t_eff; pending_cancel.append(bid); bid = None
            continue
        # flat: keep a bid inside the band
        target = f * (1 - d)
        inband = bid is not None and bid['rem'] > 0 and abs(bid['price'] / f - (1 - d)) <= w
        if not inband:
            if bid is not None:
                bid['live_to'] = t_eff; pending_cancel.append(bid); bid = None
            if tokens >= 1:
                tokens -= 1; placements += 1
                qty = Q_USD / f
                if not crossed_recently(tm, 'buy', target, 120000):          # post-only proxy
                    bid = {'side': 'bid', 'price': target, 'rem': qty, 'live_from': t_eff, 'live_to': 10**15}
    return trips, placements, path

def run_book(days, F, p):
    trips = []; plc = []; paths = []
    for day, rows in days:
        tr, pl, path = simulate_day(day, rows, F, p)
        trips += tr; plc.append(pl); paths.append((day, path))
    return trips, plc, paths

def summarize(trips, plc, ndays):
    pnl = sum(t['pnl'] for t in trips)
    # round trips = distinct entries (a position may exit in several maker fills)
    rts = len(set((t['day'], t['entry_t']) for t in trips))
    bym = collections.defaultdict(float)
    for t in trips:
        bym[t['day'][:7]] += t['pnl']
    notional = sum(t['qty'] * t['entry'] for t in trips)
    kinds = collections.Counter(t['kind'] for t in trips)
    # reporting only (not part of the frozen bar): round trips whose entry notional is at least $10, since the
    # long-tail books carry a $0.10 'dust' bot (results/m12_dust_prints.json)
    ent = collections.defaultdict(float)
    for t in trips:
        ent[(t['day'], t['entry_t'])] += t['qty'] * t['entry']
    rts10 = sum(1 for v in ent.values() if v >= 10.0)
    pnl10 = sum(t['pnl'] for t in trips if ent[(t['day'], t['entry_t'])] >= 10.0)
    return {'pnl': round(pnl, 4), 'round_trips': rts, 'round_trips_ge_10usd': rts10, 'pnl_trips_ge_10usd': round(pnl10, 4),
            'fills_exits': len(trips), 'days': ndays,
            'pnl_per_day': round(pnl / ndays, 4) if ndays else None,
            'fill_notional_per_day': round(notional / ndays, 2) if ndays else None,
            'placements_per_day_mean': round(sum(plc) / len(plc), 1) if plc else None,
            'placements_per_day_max': max(plc) if plc else None,
            'exit_kinds': dict(kinds), 'by_month': {k: round(v, 4) for k, v in sorted(bym.items())},
            'pnl_without_best_month': round(pnl - max(bym.values()), 4) if bym else None,
            'win_rate': round(sum(1 for t in trips if t['pnl'] > 0) / len(trips), 3) if trips else None}

def null_shift(paths, F, draws=2000, seed=20260923):
    """Exposure-shift null: shift each book-day's position path circularly by a uniform random minute count."""
    rng = random.Random(seed)
    # precompute per book-day the minute-to-minute fair changes dF[i] = F(end of minute i) - F(end of minute i-1)
    prepared = []
    for (book, day, path) in paths:
        if not any(path):
            prepared.append(None); continue
        d0 = int(datetime.datetime.fromisoformat(day).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
        dF = []
        for i in range(1440):
            a = F[book].get(d0 + (i - 1) * 60000); b = F[book].get(d0 + i * 60000)
            dF.append((b - a) if (a is not None and b is not None) else 0.0)
        prepared.append((path, dF))
    out = []
    for _ in range(draws):
        tot = 0.0
        for pr in prepared:
            k = rng.randrange(1440)
            if pr is None:
                continue
            path, dF = pr
            # position held at the start of minute i earns the change over minute i
            tot += sum(path[(i - k) % 1440] * dF[i] for i in range(1440) if path[(i - k) % 1440])
        out.append(tot)
    out.sort()
    return {'draws': draws, 'mean': round(sum(out) / draws, 4), 'p95': round(out[int(0.95 * draws)], 4), 'p05': round(out[int(0.05 * draws)], 4)}

def main():
    global USDC
    is_only = '--is-only' in sys.argv
    outfn = S + '/results/t12_is_only.json' if is_only else S + '/results/t12.json'
    if '--out' in sys.argv:
        outfn = sys.argv[sys.argv.index('--out') + 1]
    USDC = load_kl(R + '/data/binance_year/USDCUSDT_1m.json')
    res = {'prereg': 'prereg_revx_uk_quotes.md', 'prereg_sha256': open(S + '/prereg_revx_uk_quotes.sha256').read().split()[0],
           'is_only': is_only, 'tests': {}}
    Fs = {}
    for test, books in (('T1', T1_BOOKS + ['PENDLE-USD']), ('T2', T2_BOOKS)):
        tr_all = {'IS': [], 'OOS': []}; plc_all = {'IS': [], 'OOS': []}; paths_oos = []
        stress_all = {'IS': [], 'OOS': []}
        per_book = {}
        desc = {}
        for book in books:
            base = book.split('-')[0]
            F = fair_map(base)
            if F is None:
                per_book[book] = {'error': 'no Binance klines'}; continue
            Fs[book] = F
            days = book_days(book)
            is_days = [x for x in days if x[0] < CUT]
            oos_days = [x for x in days if x[0] >= CUT]
            if book == 'PENDLE-USD':
                # descriptive only: h from its first 25 % of sampled days (chronological), which are then not counted
                n25 = max(1, len(days) // 4)
                h, nh = h_book_from(days[:n25], F)
                is_days = []; oos_days = [x for x in days[n25:] if x[0] >= CUT]
            else:
                h, nh = h_book_from(is_days, F)
            if is_only:
                oos_days = []
            if test == 'T1':
                if h is None:
                    per_book[book] = {'error': 'no h'}; continue
                prm = {'d_bps': 0.5 * h, 'w_bps': 0.3 * h, 'tstop_min': 120, 'stop_bps': 3 * 0.5 * h, 'lat_s': 30, 'extra_bps': 0, 'taker': TAKER, 'h_bps': h}
            else:
                prm = {'d_bps': 50.0, 'w_bps': 20.0, 'tstop_min': 60, 'stop_bps': 150.0, 'lat_s': 30, 'extra_bps': 0, 'taker': TAKER, 'h_bps': h if h is not None else 10.0}
            st = dict(prm, lat_s=60, extra_bps=2.0, taker=0.0018)
            primary_book = (test == 'T1' and book != 'PENDLE-USD' and nh >= 50) or test == 'T2'
            entry = {'h_book_bps': round(h, 3) if h is not None else None, 'h_from_prints': nh, 'params': prm, 'in_primary': primary_book}
            for win, dd in (('IS', is_days), ('OOS', oos_days)):
                if not dd:
                    continue
                tr, plc, paths = run_book(dd, F, prm)
                trs, plcs, _ = run_book(dd, F, st)
                entry[win] = summarize(tr, plc, len(dd))
                entry[win + '_stress'] = summarize(trs, plcs, len(dd))
                if primary_book:
                    tr_all[win] += tr; plc_all[win] += plc; stress_all[win] += trs
                    if win == 'OOS':
                        paths_oos += [(book, day, path) for day, path in paths]
            if test == 'T2':
                for dd_bps in (30.0, 100.0):
                    pv = dict(prm, d_bps=dd_bps, w_bps=0.4 * dd_bps)
                    for win, dd in (('IS', is_days), ('OOS', oos_days)):
                        if dd:
                            tr, plc, _ = run_book(dd, F, pv)
                            entry['desc_d%d_%s' % (dd_bps, win)] = summarize(tr, plc, len(dd))
            per_book[book] = entry
        tres = {'books': per_book}
        for win in ('IS', 'OOS'):
            nd = sum(per_book[b].get(win, {}).get('days', 0) for b in per_book if isinstance(per_book[b], dict) and per_book[b].get('in_primary'))
            if nd:
                tres[win] = summarize(tr_all[win], plc_all[win], nd)
                tres[win + '_stress'] = summarize(stress_all[win], plc_all[win], nd)
        if not is_only and paths_oos:
            nl = null_shift(paths_oos, Fs)
            tres['OOS_null'] = nl
            o = tres.get('OOS', {}); s2 = tres.get('OOS_stress', {})
            need = 100 if test == 'T1' else 30
            tres['bar'] = {'1_pnl_positive': o.get('pnl', 0) > 0,
                           '2_beats_null_p95': o.get('pnl', 0) > nl['p95'],
                           '3_stress_positive': s2.get('pnl', 0) > 0,
                           '4_min_round_trips': o.get('round_trips', 0) >= need,
                           '5_without_best_month_positive': (o.get('pnl_without_best_month') or 0) > 0,
                           '6_budget': all((per_book[b].get('OOS', {}).get('placements_per_day_max') or 0) <= 800 for b in per_book if isinstance(per_book[b], dict) and per_book[b].get('in_primary'))}
            # reporting: bar 6 against its stated purpose (<= 1,000 a day with the live row's few orders); the bucket's
            # 40 starting tokens allow up to ~840 in a day, which the literal '<= 800' does not
            tres['bar6_purpose_le_1000_with_row'] = all((per_book[b].get('OOS', {}).get('placements_per_day_max') or 0) <= 960 for b in per_book if isinstance(per_book[b], dict) and per_book[b].get('in_primary'))
            tres['passes'] = all(tres['bar'].values())
        res['tests'][test] = tres
    res['inputs_sha256'] = dict(sorted(INPUTS.items()))
    json.dump(res, open(outfn, 'w'), indent=1, sort_keys=True)
    print('wrote', outfn)
    for test, tres in res['tests'].items():
        for win in ('IS', 'OOS'):
            if win in tres:
                o = tres[win]; s2 = tres[win + '_stress']
                print(test, win, 'pnl', o['pnl'], 'trips', o['round_trips'], 'days', o['days'], 'pnl/day', o['pnl_per_day'], 'plc/day', o['placements_per_day_mean'], 'exits', o['exit_kinds'], '| stress', s2['pnl'])
        if 'bar' in tres:
            print(test, 'null', tres['OOS_null'], 'bar', tres['bar'], 'PASSES' if tres['passes'] else 'FAILS')

if __name__ == '__main__':
    main()
