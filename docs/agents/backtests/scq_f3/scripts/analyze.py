# F3's arms side by side, from the replays' records (results/runs/*.json.gz): for each size (pr5 £100, p50 £50, s10
# LIVE's £10 a rung) and fill assumption (through: a print strictly through our price fills us, the twins' rule; at: a
# print at our price from the other side fills us too), each exit arm (o0 at fair, o1 and o2 one and two ticks beyond,
# o1fb<X> one tick, back to fair after X minutes) against o0 on the same size and fill:
#   trips, won, stops, realised £ (the page's `liveRungs`), the exits sent and filled, time from entry fill to the
#   trip's close, the coin the account carried (time-weighted, in £) and its GBP/USD mark risk, the positions open at
#   the end and their mark, POSTs a day; and the day-by-day paired difference of realised (trips by the UTC day they
#   closed) with a day bootstrap (random.Random(20261023), 2,000 resamples of the days with replacement, the mean
#   daily difference; the 5th percentile is index 100 of the sorted 2,000) and the two halves (09-23 → 10-01, 10-02 → 10-09).
# Writes results/summary.json.
# python3 -I scripts/analyze.py
import gzip, json, os, glob, random, math, statistics, datetime
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
runs = {os.path.basename(p)[:-8]: json.load(gzip.open(p)) for p in sorted(glob.glob(os.path.join(here, 'results', 'runs', '*.json.gz')))}
bundle = json.load(gzip.open(os.path.join(here, 'data', 'inputs.json.gz')))
UNTIL = 1791561600000
START = 1790176140000            # 2026-09-23 15:09 UTC, PR5's first decided minute
DAY = 86400000
day = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime('%Y-%m-%d')
DAYS = sorted({day(t) for t in range(START, UNTIL, DAY)} | {day(UNTIL - 1)})
H1 = [d for d in DAYS if d <= '2026-10-01']; H2 = [d for d in DAYS if d >= '2026-10-02']
ms = lambda s: int(datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)

# GBP/USD (the engine's X, GBP in USD) at each UTC day's last minute, for the coins' mark risk
fx = sorted((int(l.split('|')[1]), float(l.split('|')[2])) for l in bundle['files']['inputs.txt'].split('\n') if l.startswith('fx|'))
closes = {}
for t, v in fx:
    if START - DAY <= t < UNTIL: closes[day(t)] = v
cl = [closes[d] for d in sorted(closes)]
fx_sigma = statistics.pstdev([math.log(b / a) for a, b in zip(cl, cl[1:])])
last_px = {}
for l in bundle['files']['prints.txt'].split('\n'):
    if not l: continue
    f = l.split('|')
    if int(f[2]) < UNTIL: last_px[f[1]] = float(f[3])

def metrics(R):
    trips = R['trips']
    O = R['orders']   # [id, ts, book, rung_side, k, leg, side, state, price, base, filled, avg, fee, filled_at, not_sent, cancel_req, cancelled, fair]
    exits = [o for o in O if o[5] == 'exit' and not o[14]]
    hold_min = sorted((ms(t['tExit']) - ms(t['tEntry'])) / 60000 for t in trips)
    q = lambda xs, p: xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None
    # the account's coins over time, from every fill (conversions and top-ups included), and the rung positions alone
    ev = sorted((o[13], o[2], (1 if o[6] == 'buy' else -1) * o[10], o[5]) for o in O if o[10] > 0 and o[13] is not None)
    coin = {'USDC-GBP': 0.0, 'USDT-GBP': 0.0}; pos = {'USDC-GBP': 0.0, 'USDT-GBP': 0.0}
    t_prev, acc_coin, acc_pos, peak_pos = START, 0.0, 0.0, 0.0
    px = {'USDC-GBP': 0.755, 'USDT-GBP': 0.755}
    for t, b, d, leg in ev + [(UNTIL, None, 0, None)]:
        t = max(t, START); dt = max(0, min(t, UNTIL) - t_prev)
        acc_coin += dt * sum(coin[k] * px[k] for k in coin); acc_pos += dt * sum(abs(pos[k]) * px[k] for k in pos)
        t_prev = max(t_prev, min(t, UNTIL))
        if b is None: break
        coin[b] += d
        if leg != 'convert': pos[b] += d
        peak_pos = max(peak_pos, sum(abs(pos[k]) * px[k] for k in pos))
    span = UNTIL - START
    held = R['held']
    held_gbp = sum(h['held'] * last_px[h['book']] for h in held)
    unreal = sum((last_px[h['book']] - h['avgEntry']) * h['held'] * (1 if h['side'] == 'bid' else -1) for h in held)
    sent_days = R['days']
    full_days = [d for d in DAYS[1:-1] if d in sent_days or True]
    posts = [sent_days.get(d, 0) for d in full_days]
    return {
        'trips': len(trips), 'won': sum(t['pnlGbp'] > 0 for t in trips), 'stops': sum(t['how'] == 'stop' for t in trips),
        'realisedGbp': round(R['realisedGbp'], 4), 'tripsPnlGbp': round(sum(t['pnlGbp'] for t in trips), 4),
        'exitsSent': len(exits), 'exitsFilled': sum(o[10] > 0 for o in exits), 'exitsFilledWhole': sum(o[10] >= o[9] - 1e-9 for o in exits),
        'exitFillRate': round(sum(o[10] > 0 for o in exits) / len(exits), 4) if exits else None,
        'tripsClosedByExit': sum(t['how'] == 'exit' for t in trips),
        'holdMinutes': {'median': q(hold_min, 0.5), 'p75': q(hold_min, 0.75), 'p90': q(hold_min, 0.9), 'mean': round(statistics.mean(hold_min), 1) if hold_min else None},
        'coinGbpTimeWeighted': round(acc_coin / span, 2), 'positionsGbpTimeWeighted': round(acc_pos / span, 2), 'positionsGbpPeak': round(peak_pos, 2),
        'coinMarkRiskGbpPerDay': round(acc_coin / span * fx_sigma, 4), 'positionsMarkRiskGbpPerDay': round(acc_pos / span * fx_sigma, 4),
        'openAtEnd': len(held), 'openAtEndGbp': round(held_gbp, 2), 'openAtEndMarkGbp': round(unreal, 4),
        'postsPerDay': {'mean': round(statistics.mean(posts), 1), 'max': max(posts)}, 'deadmen': len(R['deadmen']), 'turns': R['turns'],
    }

def daily(R):
    d = {x: 0.0 for x in DAYS}
    for t in R['trips']: d[day(ms(t['tExit']))] = d.get(day(ms(t['tExit'])), 0.0) + t['pnlGbp']
    return d

def boot(diffs):
    rng = random.Random(20261023)
    n = len(diffs)
    stats = sorted(sum(diffs[rng.randrange(n)] for _ in range(n)) / n for _ in range(2000))
    return {'mean': round(sum(diffs) / n, 5), 'p5_index100': round(stats[100], 5), 'p95_index1899': round(stats[1899], 5), 'share_above_0': round(sum(s > 0 for s in stats) / 2000, 4)}

summary = {'fxDailySigma': round(fx_sigma, 6), 'days': DAYS, 'halves': {'H1': [H1[0], H1[-1]], 'H2': [H2[0], H2[-1]]}, 'arms': {}, 'paired': {}}
for name, R in runs.items():
    if name.startswith('plain_'): continue
    summary['arms'][name] = {'twin': R['twin'], 'offset': R['offset'], 'fill': R['fill'], 'fallbackMin': R['fallbackMin'], **metrics(R)}
for name, R in runs.items():
    if name.startswith('plain_') or (R['offset'] == 0 and R['fallbackMin'] is None): continue
    base = f"{R['twin']}_o0_{R['fill']}"
    if base not in runs: continue
    a, b = daily(R), daily(runs[base])
    diffs = [a[d] - b[d] for d in DAYS]
    h = lambda ds: {'sumDiffGbp': round(sum(a[d] - b[d] for d in ds), 4), 'armGbp': round(sum(a[d] for d in ds), 4), 'baseGbp': round(sum(b[d] for d in ds), 4), 'daysAhead': sum(a[d] - b[d] > 1e-9 for d in ds), 'daysBehind': sum(a[d] - b[d] < -1e-9 for d in ds)}
    summary['paired'][name] = {'against': base, 'days': len(DAYS), 'all': h(DAYS), 'H1': h(H1), 'H2': h(H2), 'bootstrap': boot(diffs),
                               'daily': {d: round(a[d] - b[d], 4) for d in DAYS}}
# LIVE (the real account, £10 a rung, from 2026-10-01 16:29:53 UTC) beside its size's replay over the same span: the
# page's own trips of LIVE as the review computed them (../scq_review/results/page_pnl.json, read 15:58 UTC).
live = json.load(open(os.path.join(here, '..', 'scq_review', 'results', 'page_pnl.json')))
GO, AT = ms('2026-10-01T16:29:53Z'), ms(live['at']) if isinstance(live['at'], str) else int(live['at'])
def span(trips):
    tt = [t for t in trips if GO <= ms(t['tEntry']) and ms(t['tExit']) <= AT]
    hm = sorted((ms(t['tExit']) - ms(t['tEntry'])) / 60000 for t in tt)
    return {'trips': len(tt), 'won': sum(t['pnlGbp'] > 0 for t in tt), 'stops': sum(t['how'] == 'stop' for t in tt), 'pnlGbp': round(sum(t['pnlGbp'] for t in tt), 4),
            'holdMinutesMedian': hm[len(hm) // 2] if hm else None}
summary['liveBeside'] = {'from': '2026-10-01T16:29:53Z', 'to': live['at'], 'LIVE': span(live['live']['trips']),
                         **{n: span(runs[n]['trips']) for n in runs if n.startswith('s10_') and not n.startswith('plain_')}}
json.dump(summary, open(os.path.join(here, 'results', 'summary.json'), 'w'), indent=1)
for k, v in summary['arms'].items():
    print(k, {x: v[x] for x in ('trips', 'won', 'stops', 'realisedGbp', 'exitFillRate', 'holdMinutes', 'positionsGbpTimeWeighted', 'openAtEnd', 'openAtEndMarkGbp', 'postsPerDay')})
print('liveBeside', json.dumps(summary['liveBeside']))
for k, v in summary['paired'].items():
    print(k, 'all', v['all']['sumDiffGbp'], 'H1', v['H1']['sumDiffGbp'], 'H2', v['H2']['sumDiffGbp'], v['bootstrap'])
