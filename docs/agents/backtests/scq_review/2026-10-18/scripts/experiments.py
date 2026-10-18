# 2026-10-18 stablecoin quotes review, §4: one change at a time to PR5's rule, replayed (scripts/replay.py) on
#   FWD  PR5's own stored record, 2026-09-26 00:00 -> 2026-10-18 00:00 UTC (the minutes and prints its engine was given;
#        the baseline reproduces its 180 paper trips to the cent, results/replay_check.json), and
#   HIST the committed nine-month tape (docs/agents/backtests/inputs/pr5_2026-09-23: Revolut X's UK prints, the USD books'
#        hourly candles, Exness GBP/USD), from 2026-08-26 (the tightened market) and from each book's listing, built by
#        pr5_sim.py's own Book (F3, as the paper engine), to 2026-09-23.
# under two fill assumptions ('through', PR5's; 'at', a print at our price fills too, which LIVE gets, F3 of 2026-10-09).
# Each variant against the baseline: daily P&L by entry day (GBP, both books), paired; 10,000 bootstrap resamples of
# whole days (seed 20261018); halves; and the days a difference of that size would need to clear zero at 95 %.
# Writes results/experiments.json.   python3 -I scripts/experiments.py   (about two minutes)
import os, sys, json, random, statistics as st, datetime, collections, importlib.util
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, 'scripts'))
import replay as RP
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..', '..'))
SEED, B = 20261018, 10000
DAY, M = RP.DAY, RP.M
FWD0, FWD1 = 1790380800000, 1792281600000            # 2026-09-26 00:00 -> 2026-10-18 00:00 UTC
iso = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime('%Y-%m-%d')
wd = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).weekday()
hr = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).hour


def load_hist(t0, t1):
    spec = importlib.util.spec_from_file_location('pr5_sim', os.path.join(REPO, 'docs', 'agents', 'scripts', 'pr5', 'pr5_sim.py'))
    S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)
    fx = S.fx_series()
    mins, prints = {}, {}
    for b in RP.BOOKS:
        a = max(t0, S.START[b])
        bk = S.Book(b, a, t1, fx)
        fu = S.fair_usd_minutes(S.USD_OF[b], a, t1)      # the USD book's fair on its own, so a dark X leaves it whole
        mins[b] = [(a + i * M, bk.X[i], fu.get(a + i * M)) for i in range(bk.n)]
        prints[b] = [(ts, pt, q, sd, f'{ts}-{j}') for j, (ts, pt, q, sd) in enumerate(bk.all_prints)]
    return mins, prints


def daily(trips, t0, t1, days_all):
    d = collections.Counter()
    for t in trips:
        if t0 <= t['tEntry'] < t1: d[iso(t['tEntry'])] += t['pnlGbp']
    return [d.get(x, 0.0) for x in days_all]


def day_list(t0, t1, only=None):
    out, t = [], t0
    while t < t1:
        if only is None or only(t): out.append(iso(t))
        t += DAY
    return out


def boot(diffs, seed=SEED):
    n = len(diffs)
    if n == 0: return None
    rng = random.Random(seed); ms = []
    for _ in range(B): ms.append(sum(diffs[rng.randrange(n)] for _ in range(n)) / n)
    ms.sort()
    mean = sum(diffs) / n
    sd = st.pstdev(diffs) if n > 1 else 0.0
    need = None
    if mean != 0 and sd > 0: need = round((1.645 * sd / abs(mean)) ** 2, 1)   # days for a one-sided 95 % mean > 0
    return {'days': n, 'mean': round(mean, 4), 'p05': round(ms[int(0.05 * B)], 4), 'p95': round(ms[int(0.95 * B) - 1], 4),
            'shareAtOrBelow0': round(sum(1 for m in ms if m <= 0) / B, 4), 'sdDaily': round(sd, 4), 'daysNeeded95': need,
            'daysAhead': sum(1 for x in diffs if x > 1e-9), 'daysBehind': sum(1 for x in diffs if x < -1e-9)}


def summary(trips, t0, t1, days, cap_gbp):
    sel = [t for t in trips if t0 <= t['tEntry'] < t1]
    pnl = sum(t['pnlGbp'] for t in sel)
    cum = peak = mdd = 0.0
    for t in sorted(sel, key=lambda z: z['tExit']):
        cum += t['pnlGbp']; peak = max(peak, cum); mdd = max(mdd, peak - cum)
    dl = daily(trips, t0, t1, days)
    sd = st.pstdev(dl) if len(dl) > 1 else 0.0
    return {'trips': len(sel), 'won': sum(t['pnlGbp'] > 0 for t in sel), 'stops': sum(t['how'] == 'taker' for t in sel),
            'open': sum(t['how'] == 'open' for t in sel), 'pnlGbp': round(pnl, 4), 'perDayGbp': round(pnl / len(days), 4),
            'capitalGbp': round(cap_gbp, 0), 'aYearPct': round(100 * pnl / cap_gbp * 365 / len(days), 2) if cap_gbp else None,
            'dailySharpe': round((sum(dl) / len(dl)) / sd, 3) if sd else None, 'maxDrawdownGbp': round(mdd, 4),
            'worstDay': round(min(dl), 4), 'notionalGbp': round(sum(t['gbp'] for t in sel), 0),
            'bps': round(1e4 * pnl / sum(t['gbp'] for t in sel), 2) if sel else None,
            'medianHoldMin': sorted((t['tExit'] - t['tEntry']) / M for t in sel)[len(sel) // 2] if sel else None}


GBPUSD = 1.33
def cap(kw):
    n = 2 * len(kw.get('rungs', (0.001, 0.002, 0.003))) * len(kw.get('books', RP.BOOKS))
    return n * kw.get('size_usd', 100.0) / GBPUSD

weekday = lambda t, b: wd(t) < 5
VARIANTS = {
    'base': {},
    # rungs
    'rungs_0.1_0.2': {'rungs': (0.001, 0.002)},
    'rungs_0.1': {'rungs': (0.001,)},
    'rungs_0.05_0.1_0.2_0.3': {'rungs': (0.0005, 0.001, 0.002, 0.003)},
    'rungs_0.15_0.25_0.35': {'rungs': (0.0015, 0.0025, 0.0035)},
    'rungs_0.1_0.2_0.3_0.4': {'rungs': (0.001, 0.002, 0.003, 0.004)},
    'rungs_0.075_0.15_0.3': {'rungs': (0.00075, 0.0015, 0.003)},
    # books
    'book_USDC_only': {'books': ['USDC-GBP']},
    'book_USDT_only': {'books': ['USDT-GBP']},
    # size (the volume cap binds sooner on a larger rung): LIVE's £10, the twins' £50 and £100
    'size_gbp10': {'size_usd': 10 * GBPUSD},
    'size_gbp50': {'size_usd': 50 * GBPUSD},
    'size_gbp200': {'size_usd': 200 * GBPUSD},
    # the stop
    'stop_12h': {'stop_ms': DAY // 2},
    'stop_48h': {'stop_ms': 2 * DAY},
    'stop_none': {'stop_ms': None},
    # re-price
    'reprice_0.03': {'reprice': 0.0003},
    'reprice_0.10': {'reprice': 0.0010},
    # exit
    'exit_minus1': {'exit_off': -1},
    'exit_plus1': {'exit_off': 1},
    # inventory: at most one / two open positions a book and side
    'max_side_1': {'max_side': 1},
    'max_side_2': {'max_side': 2},
    # time of day (UTC): no entries 21:00-23:59, none 00:00-06:59, London hours only
    'no_21_24': {'gate': lambda t, b: hr(t) < 21},
    'no_00_07': {'gate': lambda t, b: hr(t) >= 7},
    'only_07_17': {'gate': lambda t, b: 7 <= hr(t) < 17},
    # the weekend: PR5-W's rule (the last live X held through the closure)
    'weekend_xhold': {'xhold': True},
    'size_gbp10_weekend_xhold': {'size_usd': 10 * GBPUSD, 'xhold': True},
    'size_gbp50_weekend_xhold': {'size_usd': 50 * GBPUSD, 'xhold': True},
}
# comparisons against a variant other than the baseline: (variant, its comparator)
PAIRS = [('size_gbp10_weekend_xhold', 'size_gbp10'), ('size_gbp50_weekend_xhold', 'size_gbp50')]


def run_set(mins, prints, t0, t1, fill, tag):
    days = day_list(t0, t1)
    res = {}
    base = None
    for name, kw in VARIANTS.items():
        trips, orders = RP.run(mins, prints, fill=fill, t_to=t1, **kw)
        s = summary(trips, t0, t1, days, cap(kw))
        s['ordersPerDayMax'] = max((v for k, v in orders.items() if t0 // DAY <= k < t1 // DAY), default=0)
        dl = daily(trips, t0, t1, days)
        if name == 'base': base = dl
        s['vsBase'] = boot([a - b for a, b in zip(dl, base)]) if name != 'base' else None
        h = len(days) // 2
        if name != 'base':
            s['vsBaseHalves'] = [round(sum(a - b for a, b in zip(dl[:h], base[:h])), 4), round(sum(a - b for a, b in zip(dl[h:], base[h:])), 4)]
            # per £ of capital: the variant's daily return less the baseline's, in basis points of each one's capital
            cb, cv = cap({}), cap(kw)
            s['vsBasePerCapitalBpsDay'] = boot([1e4 * (a / cv - b / cb) for a, b in zip(dl, base)])
            s['weekendOnly'] = boot([a - b for a, b, d in zip(dl, base, days) if datetime.date.fromisoformat(d).weekday() >= 5])
        if name == 'base':
            s['daily'] = dict(zip(days, [round(x, 4) for x in dl]))
            byh, byw = collections.Counter(), collections.Counter()
            for t in trips:
                if t0 <= t['tEntry'] < t1: byh[hr(t['tEntry'])] += t['pnlGbp']; byw[wd(t['tEntry'])] += t['pnlGbp']
            s['byEntryHourGbp'] = {h_: round(byh[h_], 4) for h_ in range(24)}
            s['byEntryWeekdayGbp'] = {d_: round(byw[d_], 4) for d_ in range(7)}
            s['byRung'] = {}
            for t in trips:
                if t0 <= t['tEntry'] < t1:
                    k = f"{t['book']}|{t['side']}|{t['k']}"; c = s['byRung'].setdefault(k, [0, 0.0]); c[0] += 1; c[1] = round(c[1] + t['pnlGbp'], 4)
        if name == 'weekend_xhold':
            wk = [t for t in trips if t0 <= t['tEntry'] < t1 and RP.closure(t['tEntry'])]
            s['weekendTrips'] = {'n': len(wk), 'pnlGbp': round(sum(t['pnlGbp'] for t in wk), 4), 'stops': sum(t['how'] == 'taker' for t in wk),
                                 'open': sum(t['how'] == 'open' for t in wk), 'won': sum(t['pnlGbp'] > 0 for t in wk),
                                 'list': [{'book': t['book'], 'side': t['side'], 'k': t['k'], 'entry': iso(t['tEntry']) + ' ' + str(hr(t['tEntry'])) + 'h',
                                           'how': t['how'], 'holdMin': (t['tExit'] - t['tEntry']) // M, 'pnlGbp': round(t['pnlGbp'], 4)} for t in wk][:60]}
        res[name] = s
        print(f"{tag:10} {fill:8} {name:24} trips {s['trips']:4} £ {s['pnlGbp']:+8.3f} /day {s['perDayGbp']:+.4f} yr {s['aYearPct']}% "
              f"sh {s['dailySharpe']} dd {s['maxDrawdownGbp']:.3f}" + (f" | vs base {s['vsBase']['mean']:+.4f} [{s['vsBase']['p05']:+.4f},{s['vsBase']['p95']:+.4f}] P<=0 {s['vsBase']['shareAtOrBelow0']}" if s.get('vsBase') else ''))
    pairs = {}
    for a, b_ in PAIRS:
        da = daily(RP.run(mins, prints, fill=fill, t_to=t1, **VARIANTS[a])[0], t0, t1, days)
        db = daily(RP.run(mins, prints, fill=fill, t_to=t1, **VARIANTS[b_])[0], t0, t1, days)
        pairs[f'{a} - {b_}'] = boot([x - y for x, y in zip(da, db)])
        print(f"{tag:10} {fill:8} {a} - {b_}: {pairs[f'{a} - {b_}']}")
    return {'from': iso(t0), 'to': iso(t1), 'days': len(days), 'fill': fill, 'variants': res, 'pairs': pairs}


if __name__ == '__main__':
    mins, prints = RP.load()
    out = {'seed': SEED, 'resamples': B, 'gbpusdForCapital': GBPUSD, 'variants': {k: {kk: (vv if not callable(vv) else 'gate') for kk, vv in v.items()} for k, v in VARIANTS.items()}}
    for fill in ('through', 'at'):
        out[f'fwd_{fill}'] = run_set(mins, prints, FWD0, FWD1, fill, 'fwd')
    H0, H1 = 1787702400000, 1790121600000            # 2026-08-26 00:00 -> 2026-09-23 00:00 UTC
    hm, hp = load_hist(1787702400000 - 2 * DAY, H1)
    for fill in ('through', 'at'):
        out[f'hist_{fill}'] = run_set(hm, hp, H0, H1, fill, 'hist0826')
    L0 = 1767225600000                               # 2026-01-01 00:00 UTC (both books listed)
    hm2, hp2 = load_hist(L0 - 2 * DAY, H1)
    out['hist_long_through'] = run_set(hm2, hp2, L0, H1, 'through', 'hist0101')
    json.dump(out, open(os.path.join(HERE, 'results', 'experiments.json'), 'w'), indent=1)
