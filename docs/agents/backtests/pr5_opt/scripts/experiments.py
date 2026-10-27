# PR5-OPT (2026-10-27): every candidate change to LIVE's rules at £600 (£50 a rung), one at a time, replayed by sim.py on
#   FWD   PR5's own stored record (agent_quote_minutes, agent_quote_prints) 2026-09-26 00:00 -> 2026-10-27 00:00 UTC, 31 days and
#         five closures, under three fill rules: 'at' (LIVE's, the LIVE twin's), 'at50' (an AT-price print gives us only half its
#         quantity: a queue ahead) and 'through' (PR5's paper rule). LIVE sits between 'at' and 'through' (calibration.json:
#         clean days 1.20x and 0.91x of LIVE).
#   HIST  the committed tape, 2026-08-26 -> 09-23 (the tightened market, before the £0.10 bot of 10-08), 'at' and 'through'.
#   LONG  the committed tape, 2026-01-01 -> 09-23 (265 days, the wide market until 08-24), 'at' only: a sign check.
# Every run is LIVE's rules (weekend quoting on the held X) with one thing changed; capital £600 unless the change is the size.
# Each against the base, paired by day (realised by exit day, a position still held at the end marked at the last print):
# the difference in bps of capital a day, a circular 3-day block bootstrap (10,000 resamples, seed 20261027; 90 % band and the
# share at or below 0), the two halves of FWD, and HIST and LONG's differences.
#
# THE VERDICT RULE, written before the first full run: a change is BETTER when its difference is above 0 on FWD under all
# three fill rules, on HIST under both, in both halves of FWD, its FWD-'at' bootstrap puts at most 10 % at or below 0, and LONG
# is not below 0; WORSE when it is below 0 on FWD-'at', FWD-'through' and HIST-'at'; otherwise UNCLEAR.
# Writes results/experiments.json.   python3 -I scripts/experiments.py   (about five minutes)
import os, sys, json, random, statistics as st, datetime, collections, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim

HERE = sim.HERE
DAY, M, H = sim.DAY, sim.M, sim.H
SEED, B, BLOCK = 20261027, 10000, 3
ms = lambda *a: int(datetime.datetime(*a, tzinfo=datetime.timezone.utc).timestamp() * 1000)
iso = lambda t: datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime('%Y-%m-%d')
hr = lambda t: datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).hour
wd = lambda t: datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).weekday()
FWD = (ms(2026, 9, 26), ms(2026, 10, 27))
HIST = (ms(2026, 8, 26), ms(2026, 9, 23))
LONG = (ms(2026, 1, 1), ms(2026, 9, 23))
K = (0.001, 0.002, 0.003)

EVENTS = sorted(e['t'] for e in json.load(open(os.path.join(HERE, '..', 'cbreview', 'inputs', 'events.json')))['events'])


def blackout(lead_min, trail_min):
    def g(T, b, s, k):
        i = bisect.bisect_left(EVENTS, T - trail_min * M)
        return not (i < len(EVENTS) and EVENTS[i] <= T + lead_min * M)
    return g


def sizes(fn):
    """A size dict over LIVE's twelve rungs from fn(book, side, k) -> GBP, scaled to £600."""
    raw = {(b, s, k): fn(b, s, k) for b in sim.BOOKS for s in ('bid', 'ask') for k in K}
    tot = sum(raw.values())
    return {key: 600.0 * v / tot for key, v in raw.items()}


def basis_adj(mins, prints, beta):
    """fair' = fair x (1 + beta x the median of (print / fair - 1) over the book's prints of the last 24 h, refreshed hourly)."""
    tables = {}
    for b in sim.BOOKS:
        fm = {t: (fu / x) if (x and fu) else None for t, x, fu in mins.get(b, [])}
        last_x = None
        obs = []
        for t, x, fu in mins.get(b, []):
            if x: last_x = x
        pts = []
        for p in prints.get(b, []):
            f = fm.get(p[0] // M * M)
            if f: pts.append((p[0], p[1] * sim.TICK / f - 1))
        ts = [a for a, _ in pts]
        tab = {}
        if pts:
            h0, h1 = pts[0][0] // H * H, pts[-1][0] // H * H + H
            for h in range(h0, h1 + H, H):
                i, j = bisect.bisect_left(ts, h - DAY), bisect.bisect_left(ts, h)
                if j - i >= 20: tab[h] = st.median(v for _, v in pts[i:j])
        tables[b] = tab

    def adj(b, t, f):
        v = tables[b].get(t // H * H)
        return f * (1 + beta * v) if v is not None else f
    return adj


def variants(mins, prints):
    V = {
        'base': {},
        # -- size per rung (total £600)
        'size_inner_75_50_25': {'size': sizes(lambda b, s, k: {0.001: 75, 0.002: 50, 0.003: 25}[k])},
        'size_inner_100_50_0': {'size': sizes(lambda b, s, k: {0.001: 100, 0.002: 50, 0.003: 0}[k])},
        'size_outer_25_50_75': {'size': sizes(lambda b, s, k: {0.001: 25, 0.002: 50, 0.003: 75}[k])},
        'size_0.1_only': {'size': sizes(lambda b, s, k: {0.001: 1, 0.002: 0, 0.003: 0}[k])},
        # -- per book (total £600)
        'book_usdt_2to1': {'size': sizes(lambda b, s, k: 2 if b == 'USDT-GBP' else 1)},
        'book_usdt_3to1': {'size': sizes(lambda b, s, k: 3 if b == 'USDT-GBP' else 1)},
        'book_usdt_only': {'size': sizes(lambda b, s, k: 1 if b == 'USDT-GBP' else 0)},
        'book_usdc_2to1': {'size': sizes(lambda b, s, k: 2 if b == 'USDC-GBP' else 1)},
        'book_usdt_2to1_inner': {'size': sizes(lambda b, s, k: (2 if b == 'USDT-GBP' else 1) * {0.001: 75, 0.002: 50, 0.003: 25}[k])},
        # -- rung distances (a new paper engine), £600 spread equally
        'rungs_0.08_0.15_0.25': {'rungs': (0.0008, 0.0015, 0.0025)},
        'rungs_0.075_0.15_0.3': {'rungs': (0.00075, 0.0015, 0.003)},
        'rungs_0.05_0.1_0.2': {'rungs': (0.0005, 0.001, 0.002)},
        'rungs_0.15_0.25_0.35': {'rungs': (0.0015, 0.0025, 0.0035)},
        'rungs_0.1_0.2': {'rungs': (0.001, 0.002)},
        'rungs_0.1_0.15_0.2_0.3': {'rungs': (0.001, 0.0015, 0.002, 0.003)},
        'rungs_0.05_0.1_0.2_0.3': {'rungs': (0.0005, 0.001, 0.002, 0.003)},
        'rungs_0.1_0.2_0.3_0.4': {'rungs': (0.001, 0.002, 0.003, 0.004)},
        'rungs_0.075_0.15_0.25_0.4': {'rungs': (0.00075, 0.0015, 0.0025, 0.004)},
        'rungs_usdc_0.075_0.15_0.25': {'rungs_bb': {('USDC-GBP', 'bid'): (0.00075, 0.0015, 0.0025), ('USDC-GBP', 'ask'): (0.00075, 0.0015, 0.0025)}},
        'rungs_usdt_0.075_0.15_0.25': {'rungs_bb': {('USDT-GBP', 'bid'): (0.00075, 0.0015, 0.0025), ('USDT-GBP', 'ask'): (0.00075, 0.0015, 0.0025)}},
        'rungs_weekend_x1.5': {'kmul': lambda t, b: 1.5 if sim.closure(t) else 1.0},
        'rungs_weekend_x0.75': {'kmul': lambda t, b: 0.75 if sim.closure(t) else 1.0},
        # -- exits
        'exit_inside_1tick': {'exit_off': -1},
        'exit_beyond_1tick': {'exit_off': 1},
        'exit_after_2h_1tick_in': {'exit_after': (2, 1)},
        'exit_after_6h_2ticks_in': {'exit_after': (6, 2)},
        'exit_reprice_0.03': {'exit_reprice': 0.0003},
        'exit_reprice_0.10': {'exit_reprice': 0.0010},
        'reprice_0.03': {'reprice': 0.0003},
        'reprice_0.10': {'reprice': 0.0010},
        'stop_6h': {'stop_ms': 6 * H},
        'stop_12h': {'stop_ms': 12 * H},
        'stop_48h': {'stop_ms': 48 * H},
        'stop_none': {'stop_ms': None},
        # -- sub-rules
        'blackout_releases_1_5': {'gate': blackout(1, 5)},
        'blackout_releases_5_30': {'gate': blackout(5, 30)},
        'weekend_off': {'xhold': False},
        'no_entries_sun_19_21': {'gate': lambda T, b, s, k: not (wd(T) == 6 and 19 <= hr(T) < 21)},
        'no_entries_00_07': {'gate': lambda T, b, s, k: hr(T) >= 7},
        'depeg_25bps': {'depeg': 0.0025},
        'depeg_100bps': {'depeg': 0.010},
        'skew_3bps_per_rung': {'skew': (3, 3)},
        'skew_5bps_per_rung': {'skew': (5, 3)},
        'hold_min_1gbp': {'hold_min_gbp': 1.0},
        'hold_min_5gbp': {'hold_min_gbp': 5.0},
        'fair_basis_half': {'fair_adj': basis_adj(mins, prints, 0.5)},
        'fair_basis_full': {'fair_adj': basis_adj(mins, prints, 1.0)},
        # -- added after the first full run had printed (disclosed in the review): the shortlist's neighbours and combinations
        'book_usdt_3to2': {'size': sizes(lambda b, s, k: 3 if b == 'USDT-GBP' else 2)},
        'size_75_75_0': {'size': sizes(lambda b, s, k: {0.001: 1, 0.002: 1, 0.003: 0}[k])},
        'combo_usdt_2to1_hold_min_1gbp': {'size': sizes(lambda b, s, k: 2 if b == 'USDT-GBP' else 1), 'hold_min_gbp': 1.0},
        'combo_usdt_2to1_size_75_75_0': {'size': sizes(lambda b, s, k: (2 if b == 'USDT-GBP' else 1) * {0.001: 1, 0.002: 1, 0.003: 0}[k])},
        'combo_usdt_2to1_usdc_0.075_0.15_0.25': {'rungs_bb': {('USDC-GBP', 'bid'): (0.00075, 0.0015, 0.0025), ('USDC-GBP', 'ask'): (0.00075, 0.0015, 0.0025)},
                                                 'size': {(b_, s_, k_): (400.0 / 6 if b_ == 'USDT-GBP' else 200.0 / 6) for b_ in sim.BOOKS for s_ in ('bid', 'ask')
                                                          for k_ in ((0.00075, 0.0015, 0.0025) if b_ == 'USDC-GBP' else K)}},
        # -- size, for scale (per pound against £600)
        'capital_120': {'capital': 120.0},
        'capital_300': {'capital': 300.0},
        'capital_1200': {'capital': 1200.0},
    }
    return V


def daily(trips, t0, t1):
    d = collections.Counter()
    for t in trips:
        if t0 <= t['tExit'] <= t1: d[iso(min(t['tExit'], t1 - 1))] += t['pnl']
    days, x = [], t0
    while x < t1: days.append(iso(x)); x += DAY
    return days, [d.get(k, 0.0) for k in days]


def boot(diffs, seed=SEED):
    n = len(diffs)
    rng = random.Random(seed); out = []
    for _ in range(B):
        s = []
        while len(s) < n:
            i = rng.randrange(n)
            s.extend(diffs[(i + j) % n] for j in range(BLOCK))
        out.append(sum(s[:n]) / n)
    out.sort()
    return {'mean': round(sum(diffs) / n, 3), 'p05': round(out[int(0.05 * B)], 3), 'p95': round(out[int(0.95 * B) - 1], 3),
            'shareAtOrBelow0': round(sum(1 for m in out if m <= 0) / B, 4)}


def summary(trips, cap, t0, t1, marks=None):
    days, dl = daily(trips, t0, t1)
    mtm = None
    if marks is not None:
        # marked to market: each day's realised plus the change in its held rungs' mark between midnights (none at the end:
        # what is still held at t1 is in the realised, marked at the last print)
        U = [marks.get(t0 + i * DAY, 0.0) for i in range(len(days))] + [0.0]
        mtm = [1e4 * (dl[i] + U[i + 1] - U[i]) / cap for i in range(len(days))]
    sel = [t for t in trips if t0 <= t['tExit'] <= t1]
    bps = [1e4 * v / cap for v in dl]
    cum = peak = mdd = 0.0
    for v in bps:
        cum += v; peak = max(peak, cum); mdd = max(mdd, peak - cum)
    wk = sum(v for v, d in zip(bps, days) if datetime.date.fromisoformat(d).weekday() >= 5)
    return {'capitalGbp': round(cap, 2), 'days': len(days), 'trips': len(sel), 'won': round(sum(t['pnl'] > 0 for t in sel) / max(1, len(sel)), 3),
            'stops': sum(t['how'] == 'taker' for t in sel), 'open': sum(t['how'] == 'open' for t in sel),
            'bpsDay': round(sum(bps) / len(bps), 3), 'pctYear': round(sum(bps) / len(bps) * 365 / 100, 2),
            'sdDayBps': round(st.pstdev(bps), 3), 'maxDrawdownBps': round(mdd, 2), 'worstDayBps': round(min(bps), 2),
            'satSunShare': round(wk / sum(bps), 3) if sum(bps) else None,
            **({} if mtm is None else {'mtmMaxDrawdownBps': round(_mdd(mtm), 2), 'mtmWorstDayBps': round(min(mtm), 2), 'mtmSdDayBps': round(st.pstdev(mtm), 3),
                                       'mtmNegativeDays': sum(1 for v in mtm if v < 0)}),
            'perTripBps': round(1e4 * sum(t['pnl'] for t in sel) / max(1e-9, sum(t['gbp'] for t in sel)), 2)}, bps


def _mdd(xs):
    cum = peak = mdd = 0.0
    for v in xs:
        cum += v; peak = max(peak, cum); mdd = max(mdd, peak - cum)
    return mdd


def run_record(mins, prints, rec, fill_kw, V, base_key='base'):
    t0, t1 = rec
    out, base = {}, None
    for name, kw in V.items():
        marks = {}
        tr, cap = sim.run(mins, prints, t0 - 2 * DAY, t1, marks=marks, **{**fill_kw, **kw})
        s, bps = summary(tr, cap, t0, t1, marks)
        if name == base_key: base = bps
        if name != base_key:
            diff = [a - b for a, b in zip(bps, base)]
            h = len(diff) // 2
            s['vsBase'] = boot(diff)
            s['vsBaseHalves'] = [round(sum(diff[:h]) / h, 3), round(sum(diff[h:]) / (len(diff) - h), 3)]
        out[name] = s
    return out


def verdict(r):
    d = lambda rec: r[rec]['vsBase']['mean']
    fwd = [d('fwd_at'), d('fwd_at50'), d('fwd_through')]
    if all(x > 0 for x in fwd) and d('hist_at') > 0 and d('hist_through') > 0 and min(r['fwd_at']['vsBaseHalves']) > 0 \
            and r['fwd_at']['vsBase']['shareAtOrBelow0'] <= 0.10 and d('long_at') >= 0:
        return 'BETTER'
    if d('fwd_at') < 0 and d('fwd_through') < 0 and d('hist_at') < 0:
        return 'WORSE'
    return 'UNCLEAR'


if __name__ == '__main__':
    only = set(sys.argv[1:])
    fm, fp = sim.load_fwd()
    hm, hp = sim.load_hist(HIST[0] - 3 * DAY, HIST[1])
    lm, lp = sim.load_hist(LONG[0] - 3 * DAY, LONG[1])
    res = {'seed': SEED, 'resamples': B, 'blockDays': BLOCK, 'records': {'FWD': [iso(FWD[0]), iso(FWD[1])], 'HIST': [iso(HIST[0]), iso(HIST[1])], 'LONG': [iso(LONG[0]), iso(LONG[1])]},
           'by': {}}
    recs = [('fwd_at', fm, fp, FWD, {}), ('fwd_at50', fm, fp, FWD, {'at_share': 0.5}), ('fwd_through', fm, fp, FWD, {'fill': 'through'}),
            ('hist_at', hm, hp, HIST, {}), ('hist_through', hm, hp, HIST, {'fill': 'through'}), ('long_at', lm, lp, LONG, {})]
    per = {}
    for tag, m_, p_, rec, fk in recs:
        V = variants(m_, p_)
        if only: V = {k: v for k, v in V.items() if k == 'base' or k in only}
        per[tag] = run_record(m_, p_, rec, fk, V)
        print(tag, 'base', per[tag]['base'])
    for name in per['fwd_at']:
        res['by'][name] = {tag: per[tag][name] for tag in per}
        if name != 'base': res['by'][name]['verdict'] = verdict(res['by'][name])
        r = res['by'][name]
        if name != 'base':
            print(f"{name:30} {r['verdict']:8} fwd_at {r['fwd_at']['bpsDay']:6.2f} d {r['fwd_at']['vsBase']['mean']:+6.2f} [{r['fwd_at']['vsBase']['p05']:+.2f},{r['fwd_at']['vsBase']['p95']:+.2f}] "
                  f"P<=0 {r['fwd_at']['vsBase']['shareAtOrBelow0']:.3f} halves {r['fwd_at']['vsBaseHalves']} | at50 {r['fwd_at50']['vsBase']['mean']:+.2f} thr {r['fwd_through']['vsBase']['mean']:+.2f} "
                  f"| hist {r['hist_at']['vsBase']['mean']:+.2f}/{r['hist_through']['vsBase']['mean']:+.2f} long {r['long_at']['vsBase']['mean']:+.2f}")
    json.dump(res, open(os.path.join(HERE, 'results', 'experiments.json' if not only else 'experiments_partial.json'), 'w'), indent=1)
