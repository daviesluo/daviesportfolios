# REVX-FAIR (2026-10-29), part 2: candidate fairs replayed on LIVE's rules at £600, against today's fair.
#
# The engine is PR5-OPT's LIVE-realistic replay, imported unchanged (docs/agents/backtests/pr5_opt/scripts/sim.py: PR5's
# stepMinute line for line, the executor as the LIVE twin simulates it, weekends on the held X). It reproduces that review's
# base on its own window: 501 trips and 12.97 bps of capital a day here against its 502 and 12.98 (rows to 10-27 there, to
# 10-29 here). A candidate changes ONE thing, the fair, through the engine's `fair_adj` hook, so the paper engine's quotes,
# its re-pricing, the executor's exits and the de-peg guard all move with it, as they would in production.
#
# No look-ahead: every input of a candidate at paper minute t is what was stamped before t (the minute is decided on data
# to t - 1): a book snapshot through fp_data.BookSeries.at(t - 1 ms), Coinbase's touch the same, an hourly close only once
# its hour has ended, GBP/USD the minute record's own. An EMA is updated only at minutes it has a value for.
#
# Fill rules: 'at' (LIVE's own, the LIVE twin's) and 'through' (PR5's paper rule, the stricter); LIVE sits between them
# (pr5_opt calibration: clean days 1.20x and 0.91x of LIVE). Statistics: each candidate paired with the base by UTC day
# (realised by exit day, a holding at the end marked at the last print), in bps of capital a day; a circular 3-day block
# bootstrap, 10,000 resamples, seed 20261029, 90 % band and the share at or below 0.
#
# Out of sample: a family with a parameter has it chosen on the first half ('at' fill) and is judged on the second half.
#   FWD   2026-09-26 -> 10-29 (33 days, five closures); halves 09-26 -> 10-12 | 10-12 -> 10-29
#   CB    2026-10-11 -> 10-29 (Coinbase's touch is recorded from 10-10 01:47); halves 10-11 -> 10-20 | 10-20 -> 10-29
#   HIST  the committed tape 2026-08-26 -> 09-23 (pr5_opt's), for the candidates that need nothing but X and the hourly closes
#
#   FP_LIVE=<live_orders pull> python3 -I scripts/replay.py      (about three minutes; without FP_LIVE the books are not cleaned)
import os, sys, json, random, statistics as st, bisect, collections, math
HERE_S = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE_S)
sys.path.insert(0, os.path.abspath(os.path.join(HERE_S, '..', '..', 'pr5_opt', 'scripts')))
import fp_data as D
import sim

M, H, DAY = D.M, D.H, D.DAY
SEED, NB, BLOCK = 20261029, 10000, 3
CAP = 600.0
FWD = (D.ms(2026, 9, 26), D.END); FWD_SPLIT = D.ms(2026, 10, 12)
CBW = (D.ms(2026, 10, 11), D.END); CB_SPLIT = D.ms(2026, 10, 20)
HIST = (D.ms(2026, 8, 26), D.ms(2026, 9, 23)); HIST_SPLIT = D.ms(2026, 9, 9)

# ------------------------------------------------------------------ refusals: count every post-only refusal the engine makes
_blocks = sim.blocks
REFUSED = [0]


def _counting_blocks(side, ticks, lp):
    r = _blocks(side, ticks, lp)
    if r: REFUSED[0] += 1
    return r


sim.blocks = _counting_blocks


# ------------------------------------------------------------------ the causal inputs, one value per (book, paper minute)
class Inputs:
    def __init__(self, mins, live):
        self.mins = mins
        self.fs = D.fair_series(mins)
        self.revx = {b: D.BookSeries(b, live) for b in D.BOOKS}
        self.usd = {b: D.BookSeries(D.USD_OF[b], None) for b in D.BOOKS}
        self.cb = {b: D.CbSeries(b) for b in D.BOOKS}
        hrs = D.load_hours()
        self.hours = {b: hrs[D.USD_OF[b]] for b in D.BOOKS}
        self.cache = {}

    def series(self, name, b):
        """{t: value or None} over the book's minutes for a named input; cached."""
        key = (name, b)
        if key in self.cache: return self.cache[key]
        out = {}
        rows = self.mins[b]
        if name in ('revx_mid', 'revx_micro'):
            s = self.revx[b]; what = 'mid' if name == 'revx_mid' else 'micro'
            for t, *_ in rows: out[t] = s.at(t - 1, what)
        elif name == 'usd_mid':
            s = self.usd[b]
            for t, *_ in rows: out[t] = s.at(t - 1, 'mid')
        elif name == 'cb_mid':
            s = self.cb[b]
            for t, *_ in rows: out[t] = s.at(t - 1, 'mid')
        elif name.startswith('fu_med_'):                      # the median of the hourly closes of the last N hours
            n = int(name.split('_')[-1]); hs = self.hours[b]; starts = [h[0] for h in hs]
            for t, *_ in rows:
                lo = bisect.bisect_left(starts, t - n * H); hi = bisect.bisect_right(starts, t - H)
                v = [c for _, c in hs[lo:hi]]
                out[t] = st.median(v) if v else None
        elif name == 'x_prev':                                # the X the previous minute was decided on
            prev = None
            for t, x, fu, lag in rows:
                out[t] = prev; prev = x
        self.cache[key] = out
        return out

    def ema(self, name, b, hl_min, base='fair'):
        """EMA over minutes of (input / base fair - 1), half-life hl_min, updated only where the input exists."""
        key = ('ema', name, b, hl_min)
        if key in self.cache: return self.cache[key]
        src = self.series(name, b); fs = self.fs[b]
        out = {}; e = None; last = None
        for t, *_ in self.mins[b]:
            f = fs[t][0]; v = src.get(t)
            if f and v:
                g = v / f - 1
                if e is None: e = g
                else: e += (1 - 0.5 ** ((t - last) / M / hl_min)) * (g - e)
                last = t
            out[t] = e
        self.cache[key] = out
        return out


def make_candidates(I):
    """name -> (fair_adj or None, window, family, param). Each fair_adj(book, t, f) -> f' (f when its input is missing)."""
    C = {}
    C['base'] = (None, 'FWD', 'base', None)
    # 1. fairU from the USD book's live mid (Revolut X's own USDC-USD / USDT-USD, the book whose hourly closes it uses)
    for hl in (0, 60, 360):
        def f_usd(b, t, f, hl=hl):
            fu = I.fs[b][t][2]
            if not fu: return f
            if hl == 0:
                u = I.series('usd_mid', b).get(t)
                return f * u / fu if (u and abs(u / fu - 1) < 0.005) else f
            e = _usd_ema(I, b, hl).get(t)
            return f * (1 + e) if e is not None else f
        C[f'fairU_usd_live_hl{hl}'] = (f_usd, 'FWD', 'fairU_usd_live', hl)
    # 2. a shorter median of the hourly closes
    for n in (3, 6, 12):
        def f_med(b, t, f, n=n):
            fu = I.fs[b][t][2]; m = I.series(f'fu_med_{n}', b).get(t)
            return f * m / fu if (fu and m) else f
        C[f'fairU_median_{n}h'] = (f_med, 'FWD', 'fairU_median', n)
    # 3. par: the coin at exactly one dollar (no peg drift at all)
    def f_par(b, t, f):
        fu = I.fs[b][t][2]
        return f / fu if fu else f
    C['fairU_par'] = (f_par, 'FWD', 'fairU_par', None)
    # 4. the venue's own GBP book: its clean mid blended in at weight w, at once
    for w in (0.25, 0.5):
        def f_mid(b, t, f, w=w):
            m = I.series('revx_mid', b).get(t)
            return (1 - w) * f + w * m if m and abs(m / f - 1) < 0.005 else f
        C[f'revx_mid_w{w}'] = (f_mid, 'FWD', 'revx_mid_blend', w)
    def f_mic(b, t, f):
        m = I.series('revx_micro', b).get(t)
        return 0.5 * f + 0.5 * m if m and abs(m / f - 1) < 0.005 else f
    C['revx_micro_w0.5'] = (f_mic, 'FWD', 'revx_micro_blend', 0.5)
    # 5. the venue's own basis to fair, smoothed (EMA of clean mid / fair - 1), weight w
    for hl in (60, 360):
        for w in (0.5, 1.0):
            def f_eb(b, t, f, hl=hl, w=w):
                e = I.ema('revx_mid', b, hl).get(t)
                return f * (1 + w * e) if e is not None and abs(e) < 0.005 else f
            C[f'revx_basis_ema{hl}_w{w}'] = (f_eb, 'FWD', 'revx_basis_ema', (hl, w))
    # 6. GBP/USD's lag: X extrapolated one minute along its last move
    for beta in (0.5, 1.0):
        def f_lag(b, t, f, beta=beta):
            x = I.fs[b][t][1]; xp = I.series('x_prev', b).get(t); fu = I.fs[b][t][2]
            if not (x and xp and fu) or I.fs[b][t][3]: return f
            return fu / (x + beta * (x - xp))
        C[f'fx_extrapolate_b{beta}'] = (f_lag, 'FWD', 'fx_extrapolate', beta)
    # 7. Coinbase as a live FX: fair moved by Coinbase's mid's deviation from its own 24 h basis to fair (cross-venue)
    for w in (0.5, 1.0):
        def f_cb(b, t, f, w=w):
            m = I.series('cb_mid', b).get(t); e = I.ema('cb_mid', b, 1440).get(t)
            if not m or e is None: return f
            dev = m / f - 1 - e
            return f * (1 + w * dev) if abs(dev) < 0.005 else f
        C[f'cb_dev_w{w}'] = (f_cb, 'CB', 'cb_dev', w)
    # 8. the same, inside FX closures only: the weekend fair follows Coinbase's GBP price from Friday's close
    def f_cbwk(b, t, f):
        if not I.fs[b][t][3]: return f                      # only minutes priced on the held X
        m = I.series('cb_mid', b).get(t); e = I.ema('cb_mid', b, 1440).get(t)
        if not m or e is None: return f
        dev = m / f - 1 - e
        return f * (1 + dev) if abs(dev) < 0.005 else f
    C['cb_dev_closure_only'] = (f_cbwk, 'CB', 'cb_dev_closure', 1.0)
    # 9. Coinbase's mid blended in directly (its level, basis and all), weight 0.5
    def f_cbmid(b, t, f):
        m = I.series('cb_mid', b).get(t)
        return 0.5 * f + 0.5 * m if m and abs(m / f - 1) < 0.005 else f
    C['cb_mid_w0.5'] = (f_cbmid, 'CB', 'cb_mid_blend', 0.5)
    return C


def _usd_ema(I, b, hl):
    """EMA of (USD book's clean mid / fairU - 1): the live USD price's gap to the 24 h median, smoothed."""
    key = ('usdema', b, hl)
    if key in I.cache: return I.cache[key]
    src = I.series('usd_mid', b); out = {}; e = None; last = None
    for t, x, fu, lag in I.mins[b]:
        v = src.get(t)
        if fu and v:
            g = v / fu - 1
            if e is None: e = g
            else: e += (1 - 0.5 ** ((t - last) / M / hl)) * (g - e)
            last = t
        out[t] = e if (e is not None and abs(e) < 0.005) else None
    I.cache[key] = out
    return out


# ------------------------------------------------------------------ running and scoring
def daily(trips, t0, t1):
    d = collections.OrderedDict((t, 0.0) for t in range(t0, t1, DAY))
    for tr in trips:
        k = (min(max(tr['tExit'], t0), t1 - 1) - t0) // DAY * DAY + t0
        d[k] = d.get(k, 0.0) + tr['pnl']
    return d


def one(mins3, prints, win, fill, adj):
    REFUSED[0] = 0
    trips, cap = sim.run(mins3, prints, win[0], win[1], fill=fill, fair_adj=adj)
    return trips, REFUSED[0]


def summary(trips, refused, win):
    d = daily(trips, *win)
    days = len(d)
    tot = sum(d.values())
    return {'bpsDay': round(tot / CAP * 1e4 / days, 3), 'trips': len(trips), 'stops': sum(1 for t in trips if t['how'] == 'taker'),
            'open': sum(1 for t in trips if t['how'] == 'open'), 'refusals': refused,
            'perTripBps': round(1e4 * sum(t['pnl'] for t in trips) / max(1e-9, sum(t['gbp'] for t in trips)), 2),
            'closureEntryBpsDay': round(sum(t['pnl'] for t in trips if t['tEntry'] and D.closure(t['tEntry'])) / CAP * 1e4 / days, 3)}


def boot(diff_days, seed=SEED):
    v = list(diff_days); n = len(v)
    if n < BLOCK + 1: return None
    rnd = random.Random(seed); out = []
    for _ in range(NB):
        s = []
        while len(s) < n:
            i = rnd.randrange(n)
            s.extend(v[(i + j) % n] for j in range(BLOCK))
        out.append(st.fmean(s[:n]))
    out.sort()
    return [round(out[int(0.05 * NB)], 3), round(out[int(0.95 * NB)], 3), round(sum(1 for x in out if x <= 0) / NB, 4)]


def paired(base_trips, cand_trips, win, split):
    db, dc = daily(base_trips, *win), daily(cand_trips, *win)
    diff = [(dc[k] - db[k]) / CAP * 1e4 for k in db]
    keys = list(db)
    h1 = [x for k, x in zip(keys, diff) if k < split]; h2 = [x for k, x in zip(keys, diff) if k >= split]
    out = {'diffBpsDay': round(st.fmean(diff), 3), 'boot90_pLe0': boot(diff), 'h1': round(st.fmean(h1), 3), 'h2': round(st.fmean(h2), 3),
           'h2_boot90_pLe0': boot(h2), 'daysAhead': sum(1 for x in diff if x > 1e-9), 'daysBehind': sum(1 for x in diff if x < -1e-9), 'days': len(diff)}
    # each book apart: the engine runs the books independently, so a book's share is exactly the candidate on that book alone
    for b in D.BOOKS:
        bb = daily([t for t in base_trips if t['book'] == b], *win); bc = daily([t for t in cand_trips if t['book'] == b], *win)
        d_ = [(bc[k] - bb[k]) / CAP * 1e4 for k in bb]
        out[f'book_{b}'] = {'diffBpsDay': round(st.fmean(d_), 3), 'boot90_pLe0': boot(d_),
                            'h1': round(st.fmean([x for k, x in zip(keys, d_) if k < split]), 3),
                            'h2': round(st.fmean([x for k, x in zip(keys, d_) if k >= split]), 3)}
    return out


def main():
    mins = D.load_minutes(); prints = D.load_prints(); live = D.load_live_orders()
    I = Inputs(mins, live)
    mins3 = {b: [(t, x, fu) for (t, x, fu, lag) in v] for b, v in mins.items()}
    C = make_candidates(I)
    wins = {'FWD': (FWD, FWD_SPLIT), 'CB': (CBW, CB_SPLIT)}
    res = {'windows': {'FWD': ['2026-09-26', '2026-10-29', '2026-10-12'], 'CB': ['2026-10-11', '2026-10-29', '2026-10-20'],
                       'HIST': ['2026-08-26', '2026-09-23', '2026-09-09']},
           'clean_books': bool(live), 'runs': {}}
    base = {}
    for wn, (win, split) in wins.items():
        for fill in ('at', 'through'):
            tr, rf = one(mins3, prints, win, fill, None)
            base[(wn, fill)] = tr
            res['runs'][f'base|{wn}|{fill}'] = summary(tr, rf, win)
    for name, (adj, wn, fam, par) in C.items():
        if name == 'base': continue
        win, split = wins[wn]
        for fill in ('at', 'through'):
            tr, rf = one(mins3, prints, win, fill, adj)
            r = summary(tr, rf, win)
            r.update(paired(base[(wn, fill)], tr, win, split))
            r.update(family=fam, param=par, window=wn)
            res['runs'][f'{name}|{wn}|{fill}'] = r
            print(name, wn, fill, r['bpsDay'], r['diffBpsDay'], r['boot90_pLe0'], r['h1'], r['h2'], flush=True)
        # the CB-window candidates are also scored on FWD's base where they have no input (fall back to today's fair)
    # out of sample: per family, the parameter with the best first half under 'at', judged on the second half
    fams = collections.defaultdict(list)
    for k, r in res['runs'].items():
        if k.startswith('base|') or not k.endswith('|at'): continue
        fams[r['family']].append((k.split('|')[0], r))
    oos = {}
    for fam, lst in fams.items():
        best = max(lst, key=lambda z: z[1]['h1'])
        thr = res['runs'][f"{best[0]}|{best[1]['window']}|through"]
        oos[fam] = {'chosen': best[0], 'h1_at': best[1]['h1'], 'h2_at': best[1]['h2'], 'h2_at_boot90_pLe0': best[1]['h2_boot90_pLe0'],
                    'h2_through': thr['h2'], 'h2_through_boot90_pLe0': thr['h2_boot90_pLe0']}
    res['oos'] = oos
    # HIST: the candidates that need only X and the hourly closes (nothing else was recorded before 09-25)
    try:
        hm, hp = sim.load_hist(*HIST)
        res['hist'] = hist_runs(hm, hp)
    except Exception as e:   # the tape's loader needs the committed inputs; say so rather than fail
        res['hist'] = {'error': str(e)[:300]}
    json.dump(res, open(os.path.join(D.HERE, 'results', 'replay.json'), 'w'), indent=1, sort_keys=True)


def hist_runs(hm, hp):
    """On the committed tape: fairU from a shorter median of hourly closes, par, and X extrapolated, against the base."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('pr5_sim', os.path.join(sim.REPO, 'docs', 'agents', 'scripts', 'pr5', 'pr5_sim.py'))
    S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)
    out = {}
    win = HIST
    base = {}
    xprev = {b: {} for b in hm}
    for b in hm:
        p = None
        for t, x, fu in hm[b]: xprev[b][t] = p; p = x
    # hourly closes of the USD books on the tape: rebuild fairU over N hours from pr5_sim's own hourly series
    med = {}
    for n in (3, 6, 12):
        med[n] = {}
        for b in hm:
            rows_ = json.load(S._open(os.path.join(S.S, 'data', 'candles', f'{S.USD_OF[b]}_60.json')))['rows']
            hours = sorted((int(h['start']), float(h['close'])) for h in rows_)
            starts = [h[0] for h in hours]
            d = {}
            for t, x, fu in hm[b]:
                lo = bisect.bisect_left(starts, t - n * H); hi = bisect.bisect_right(starts, t - H)
                v = [c for _, c in hours[lo:hi]]; d[t] = st.median(v) if v else None
            med[n][b] = d
    fu_of = {b: {t: fu for t, x, fu in hm[b]} for b in hm}
    x_of = {b: {t: x for t, x, fu in hm[b]} for b in hm}
    cands = {'fairU_par': lambda b, t, f: f / fu_of[b][t] if fu_of[b].get(t) else f}
    for beta in (0.5, 1.0):
        cands[f'fx_extrapolate_b{beta}'] = (lambda b, t, f, beta=beta: fu_of[b][t] / (x_of[b][t] + beta * (x_of[b][t] - xprev[b][t]))
                                            if (x_of[b].get(t) and xprev[b].get(t) and fu_of[b].get(t)) else f)
    for n in (3, 6, 12):
        if med[n]: cands[f'fairU_median_{n}h'] = (lambda b, t, f, n=n: f * med[n][b][t] / fu_of[b][t] if (med[n][b].get(t) and fu_of[b].get(t)) else f)
    for fill in ('at', 'through'):
        tr, rf = one(hm, hp, win, fill, None); base[fill] = tr
        out[f'base|{fill}'] = summary(tr, rf, win)
        for name, adj in cands.items():
            t2, r2 = one(hm, hp, win, fill, adj)
            r = summary(t2, r2, win); r.update(paired(tr, t2, win, HIST_SPLIT))
            out[f'{name}|{fill}'] = r
            print('HIST', name, fill, r['bpsDay'], r['diffBpsDay'], r['boot90_pLe0'], flush=True)
    return out


if __name__ == '__main__':
    main()
