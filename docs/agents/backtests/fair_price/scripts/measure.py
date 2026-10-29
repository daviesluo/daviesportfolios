# REVX-FAIR (2026-10-29), part 1: how PR5's fair compares with the markets it is quoted into, and what LIVE's fills say
# about it. Read-only on the committed pull; LIVE's own orders from $FP_LIVE (not committed). Writes results/measure.json.
#
#   A. Where fair sits in the market: (reference / fair - 1) in bps for Revolut X's own book (mid and microprice, LIVE's own
#      resting orders taken out, the touch the first level with >= 50 coin) and Coinbase's mid, weekday vs closure, by hour.
#   B. Which number at t best foretells the market at t+h: mean absolute error in bps of fair and its candidates against
#      Revolut X's clean mid and Coinbase's mid h = 5, 15, 60 and 240 minutes later (weekday and closure apart).
#   C. LIVE's fills: each fill placed in time by the first print through or at its price (else the executor's read-back),
#      its edge at the fill and its markout h minutes on against fair, the clean mid and Coinbase's mid, by book, side, rung,
#      weekday/closure and hour of day. Sign: POSITIVE IS FOR US (a bid filled below where the reference later stands).
#      The price is the order's limit (a maker fill is at it; `avg_fill_price` carries the £0.11 buy-back's whole penny, F1).
#      Intervals: day-block bootstrap of the mean, 5,000 resamples, seed 20261029, 90 %.
#   D. Stale and crossed: the GBP/USD bar's age, how often fair moves past the 0.05 % re-price step in a minute, how often
#      the clean book stands wholly to one side of fair by more than the inner rung, LIVE's refused entries.
#
#   FP_LIVE=<path to the live_orders pull> python3 -I scripts/measure.py
import os, sys, json, random, statistics as st, bisect, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fp_data as D

M, H, DAY = D.M, D.H, D.DAY
SEED, B = 20261029, 5000
HZ = (1, 5, 15, 60, 240)


def q(a, ps=(0.1, 0.25, 0.5, 0.75, 0.9)):
    if not a: return None
    s = sorted(a)
    return [round(s[min(len(s) - 1, int(p * len(s)))], 2) for p in ps]


def summ(a):
    return {'n': len(a), 'mean': round(st.fmean(a), 2) if a else None, 'median': round(st.median(a), 2) if a else None, 'q10_25_50_75_90': q(a)}


def boot_mean(pairs, seed=SEED):
    """pairs: [(day, value)]. Day-block bootstrap of the mean over all values; 90 % band."""
    if len(pairs) < 3: return None
    by = collections.defaultdict(list)
    for d, v in pairs: by[d].append(v)
    days = sorted(by)
    rnd = random.Random(seed)
    out = []
    for _ in range(B):
        s = n = 0
        for _ in days:
            vs = by[days[rnd.randrange(len(days))]]
            s += sum(vs); n += len(vs)
        out.append(s / n if n else 0)
    out.sort()
    return [round(out[int(0.05 * B)], 2), round(out[int(0.95 * B)], 2)]


def hb(t):
    h = D.hour(t)
    return '00-06' if h < 7 else '07-11' if h < 12 else '12-16' if h < 17 else '17-23'


def main():
    mins = D.load_minutes(); prints = D.load_prints(); live = D.load_live_orders()
    fs = D.fair_series(mins)
    books = {b: D.BookSeries(b, live) for b in D.BOOKS}
    cbs = {b: D.CbSeries(b) for b in D.BOOKS}
    usd = {b: D.BookSeries(D.USD_OF[b], None, min_qty=50.0) for b in D.BOOKS}
    out = {'clean_books': {b: {'snapshots': len(books[b].t), 'own_orders': books[b].own_n, 'levels_reduced': books[b].removed} for b in D.BOOKS} if live else 'raw (no FP_LIVE)'}

    # ---------------------------------------------------------------- A
    A = {}
    for b in D.BOOKS:
        bs, cb = books[b], cbs[b]
        rec = collections.defaultdict(list)
        for i, t in enumerate(bs.t):
            f = D.fair_at(fs, b, t)
            if not f: continue
            w = 'closure' if D.closure(t) else 'weekday'
            if bs.mid[i]:
                rec[('revx_mid', w)].append((bs.mid[i] / f - 1) * 1e4)
                rec[('revx_micro', w)].append((bs.micro[i] / f - 1) * 1e4)
                rec[('revx_spread', w)].append((bs.ba[i] / bs.bb[i] - 1) * 1e4)
                if w == 'weekday': rec[('revx_mid_hour', hb(t))].append((bs.mid[i] / f - 1) * 1e4)
        for t, m in zip(cb.t, cb.mid):
            f = D.fair_at(fs, b, t)
            if not f: continue
            w = 'closure' if D.closure(t) else 'weekday'
            rec[('cb_mid', w)].append((m / f - 1) * 1e4)
            r = bs.at(t)
            if r: rec[('revx_mid_minus_cb', w)].append((r / m - 1) * 1e4)
        # the USD book's live mid against fairU (the 24 h median of hourly closes the fair divides)
        ub = usd[b]
        for i, t in enumerate(ub.t):
            m = (t - M) // M * M
            v = fs[b].get(m)
            if v and v[2] and ub.mid[i]:
                rec[('usd_mid_vs_fairU', 'closure' if D.closure(t) else 'weekday')].append((ub.mid[i] / v[2] - 1) * 1e4)
        # day by day: the median gap of the clean mid and of Coinbase to fair (how persistent the basis is)
        dd = collections.defaultdict(list); dc = collections.defaultdict(list)
        for i, t in enumerate(bs.t):
            f = D.fair_at(fs, b, t)
            if f and bs.mid[i]: dd[D.day(t)].append((bs.mid[i] / f - 1) * 1e4)
        for t, m in zip(cb.t, cb.mid):
            f = D.fair_at(fs, b, t)
            if f: dc[D.day(t)].append((m / f - 1) * 1e4)
        A[b] = {f'{k[0]}|{k[1]}': summ(v) for k, v in sorted(rec.items())}
        A[b]['daily_median_revx_mid_vs_fair'] = {d: round(st.median(v), 2) for d, v in sorted(dd.items())}
        A[b]['daily_median_cb_mid_vs_fair'] = {d: round(st.median(v), 2) for d, v in sorted(dc.items())}
    out['A_basis_bps'] = A

    # ---------------------------------------------------------------- B
    # Predictors known at t (each reads only what was stamped before t); targets at t + h.
    Bres = {}
    for b in D.BOOKS:
        bs, cb = books[b], cbs[b]
        ema = None; last_t = None
        res = collections.defaultdict(list)
        grid = range(D.ms(2026, 10, 11), D.END - 240 * M, 5 * M)
        for t in grid:
            f = D.fair_at(fs, b, t)
            if not f: continue
            mid = bs.at(t); cbm = cbs[b].at(t)
            if mid:
                bas = mid / f - 1
                ema = bas if ema is None else ema + (1 - pow(0.5, 5 / 60)) * (bas - ema)   # 60-min half-life on a 5-min grid
            preds = {'fair': f, 'revx_mid': mid, 'revx_micro': bs.at(t, 'micro'), 'cb_mid': cbm,
                     'fair_half_revx_mid': (f + mid) / 2 if mid else None,
                     'fair_x_ema_basis': f * (1 + ema) if ema is not None else None,
                     'fair_half_cb': (f + cbm) / 2 if cbm else None}
            w = 'closure' if D.closure(t) else 'weekday'
            for h in (5, 15, 60, 240):
                for tn, tv in (('revx_mid', bs.at(t + h * M)), ('cb_mid', cb.at(t + h * M))):
                    if not tv: continue
                    for pn, pv in preds.items():
                        if pv: res[(tn, h, w, pn)].append(abs(pv / tv - 1) * 1e4)
        Bres[b] = {f'{tn}+{h}m|{w}': {pn: round(st.fmean(res[(tn, h, w, pn)]), 2) for pn in ('fair', 'revx_mid', 'revx_micro', 'cb_mid', 'fair_half_revx_mid', 'fair_x_ema_basis', 'fair_half_cb') if res.get((tn, h, w, pn))}
                   for (tn, h, w) in sorted({k[:3] for k in res})}
        Bres[b]['n_grid_points'] = len(range(D.ms(2026, 10, 11), D.END - 240 * M, 5 * M))
    out['B_mae_bps_from_2026-10-11'] = Bres

    # ---------------------------------------------------------------- C
    C = {}
    if live:
        fills = [o for o in live if o['mode'] == 'live' and o['state'] == 'filled' and o['leg'] in ('entry', 'exit') and o['filled'] > 0]
        P = {b: prints.get(b, []) for b in D.BOOKS}
        PT = {b: [p[0] for p in P[b]] for b in D.BOOKS}
        rows = []
        located = 0
        for o in fills:
            b = o['book']; px = o['price']; tk = round(o['price'] / D.TICK)
            sgn = 1 if o['side'] == 'buy' else -1
            lo, hi = o['ts'], o['filled_at'] or o['ts']
            tf = hi
            i = bisect.bisect_left(PT[b], lo)
            while i < len(P[b]) and P[b][i][0] <= hi:
                p = P[b][i]
                if (sgn == 1 and (p[1] < tk or (p[1] == tk and p[3] == 'sell'))) or (sgn == -1 and (p[1] > tk or (p[1] == tk and p[3] == 'buy'))):
                    tf = p[0]; located += 1; break
                i += 1
            f0 = D.fair_at(fs, b, tf)
            r = {'leg': o['leg'], 'book': b, 'side': 'bid' if sgn == 1 else 'ask', 'k': o['k'], 't': tf, 'day': D.day(tf),
                 'w': 'closure' if D.closure(tf) else 'weekday', 'hb': hb(tf)}
            refs0 = {'fair': f0, 'revx_mid': books[b].at(tf - 1), 'cb_mid': cbs[b].at(tf)}
            for rn, rv in refs0.items():
                r[f'edge_{rn}'] = sgn * (rv / px - 1) * 1e4 if rv else None
            for h in HZ:
                for rn, rv in (('fair', D.fair_at(fs, b, tf + h * M)), ('revx_mid', books[b].at(tf + h * M)), ('cb_mid', cbs[b].at(tf + h * M))):
                    r[f'mo{h}_{rn}'] = sgn * (rv / px - 1) * 1e4 if rv else None
            rows.append(r)
        C['fills'] = len(rows); C['located_by_print'] = located

        def block(sel, label):
            g = {}
            for key in [f'edge_{x}' for x in ('fair', 'revx_mid', 'cb_mid')] + [f'mo{h}_{x}' for h in HZ for x in ('fair', 'revx_mid', 'cb_mid')]:
                pairs = [(r['day'], r[key]) for r in sel if r[key] is not None]
                if not pairs: continue
                v = [p[1] for p in pairs]
                g[key] = {'n': len(v), 'mean': round(st.fmean(v), 2), 'median': round(st.median(v), 2), 'boot90': boot_mean(pairs)}
            return g
        groups = {}
        for leg in ('entry', 'exit'):
            E = [r for r in rows if r['leg'] == leg]
            groups[f'{leg}|all'] = block(E, 'all')
            for b in D.BOOKS:
                groups[f'{leg}|{b}'] = block([r for r in E if r['book'] == b], b)
                for s in ('bid', 'ask'):
                    groups[f'{leg}|{b}|{s}'] = block([r for r in E if r['book'] == b and r['side'] == s], s)
            if leg == 'entry':
                for k in (0.001, 0.002, 0.003):
                    groups[f'entry|k={k}'] = block([r for r in E if r['k'] and abs(r['k'] - k) < 1e-9], k)
                for w in ('weekday', 'closure'):
                    groups[f'entry|{w}'] = block([r for r in E if r['w'] == w], w)
                    for b in D.BOOKS: groups[f'entry|{w}|{b}'] = block([r for r in E if r['w'] == w and r['book'] == b], w)
                for h in ('00-06', '07-11', '12-16', '17-23'):
                    groups[f'entry|hour {h}'] = block([r for r in E if r['hb'] == h and r['w'] == 'weekday'], h)
        C['groups'] = groups
        # holding: entry fill to the rung's next exit/stop fill, by book and side
        hold = collections.defaultdict(list)
        seq = sorted([o for o in live if o['mode'] == 'live' and o['state'] == 'filled' and o['leg'] in ('entry', 'exit', 'stop')], key=lambda o: o['filled_at'] or o['ts'])
        open_ = {}
        for o in seq:
            key = (o['book'], o['rung_side'], o['k'])
            if o['leg'] == 'entry':
                open_.setdefault(key, o['filled_at'])
            elif key in open_:
                hold[(o['book'], o['rung_side'], o['leg'])].append((o['filled_at'] - open_.pop(key)) / M)
        C['holding_minutes'] = {f'{k[0]}|{k[1]}|closed by {k[2]}': summ(v) for k, v in sorted(hold.items())}
        C['entry_fills_by_side'] = {f'{b}|{s}': sum(1 for r in rows if r['leg'] == 'entry' and r['book'] == b and r['side'] == s) for b in D.BOOKS for s in ('bid', 'ask')}
        ent = [o for o in live if o['mode'] == 'live' and o['leg'] == 'entry']
        C['live_entries'] = {'orders': len(ent), 'rejected': sum(1 for o in ent if o['state'] == 'rejected'),
                             'filled': sum(1 for o in ent if o['state'] == 'filled')}
    out['C_live_fills'] = C

    # ---------------------------------------------------------------- D
    Dd = {}
    for b in D.BOOKS:
        rows = mins[b]
        lags = [l for (t, x, fu, l) in rows if x and l is not None]
        prev = None; moves = n = big = 0
        for (t, x, fu, l) in rows:
            f = fs[b][t][0]
            if f and prev:
                n += 1
                if abs(f / prev - 1) > 0.0005: moves += 1
                if abs(f / prev - 1) > 0.001: big += 1
            prev = f
        bs = books[b]
        off = tot = 0; side_off = collections.Counter()
        for i, t in enumerate(bs.t):
            f = D.fair_at(fs, b, t)
            if not f or not bs.bb[i]: continue
            tot += 1
            if bs.bb[i] > f * 1.001: off += 1; side_off['book above fair+10bps'] += 1
            elif bs.ba[i] < f * 0.999: off += 1; side_off['book below fair-10bps'] += 1
        # when the clean mid stands more than 10 bps from fair, who moves: the book back to fair, or fair to the book?
        # gap0 = mid/fair - 1 at the snapshot; after h minutes, the share of the gap closed by the book's move and by fair's.
        conv = {}
        for h in (15, 60, 240):
            bk = []; fr = []; left = []
            for i, t in enumerate(bs.t):
                f = D.fair_at(fs, b, t)
                if not f or not bs.mid[i]: continue
                g0 = bs.mid[i] / f - 1
                if abs(g0) <= 0.001: continue
                f1 = D.fair_at(fs, b, t + h * M); m1 = bs.at(t + h * M)
                if not f1 or not m1: continue
                bk.append(-(m1 / bs.mid[i] - 1) / g0); fr.append((f1 / f - 1) / g0); left.append((m1 / f1 - 1) / g0)
            conv[f'{h}m'] = {'n': len(bk), 'book_closed_median': round(st.median(bk), 3) if bk else None,
                             'fair_closed_median': round(st.median(fr), 3) if fr else None, 'gap_left_median': round(st.median(left), 3) if left else None}
        Dd.setdefault('gap_over_10bps_who_closes', {})[b] = conv
        Dd[b] = {'x_lag_minutes': dict(collections.Counter(lags).most_common(6)), 'dark_minutes': sum(1 for r in rows if not r[1]),
                 'minutes_with_fair': n, 'fair_moves_over_5bps_in_a_minute': moves, 'over_10bps': big,
                 'snapshots_book_wholly_beyond_inner_rung': off, 'of_snapshots': tot, 'which': dict(side_off)}
    out['D_stale_crossed'] = Dd
    json.dump(out, open(os.path.join(D.HERE, 'results', 'measure.json'), 'w'), indent=1, sort_keys=True)
    print(json.dumps(out, indent=1, sort_keys=True)[:200])


if __name__ == '__main__':
    main()
