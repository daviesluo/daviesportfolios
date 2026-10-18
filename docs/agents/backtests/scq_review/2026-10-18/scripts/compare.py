# 2026-10-18 stablecoin quotes review, §1-§3: every Revolut X row on one basis, the testing rows ranked, LIVE's fills taken
# apart. Reads results/page_pnl.json (the page's own trips, scripts/page_pnl.ts), data/order_counts.json, data/paper_engines.json
# and data/prints.txt (the stored UK tape, for markouts); writes results/compare.json.
#   python3 -I scripts/compare.py   (from this folder)
import json, random, os, sys, bisect, statistics as st
from datetime import datetime, timezone, timedelta, date

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, 'scripts'))
from replay import _lines as RPL
R = json.load(open(os.path.join(HERE, 'results', 'page_pnl.json')))
OC = json.load(open(os.path.join(HERE, 'data', 'order_counts.json')))['rows']
PE = json.load(open(os.path.join(HERE, 'data', 'paper_engines.json')))
NOW = datetime.fromisoformat(R['at'].replace('Z', '+00:00'))
RUNG = {'live': 10.0, 'pr5': 100.0, 'p50': 50.0, 'take50': 50.0, 'd': 50.0}
CAP = {'live': 120.0, 'pr5': 1200.0, 'p50': 600.0, 'take50': 600.0, 'd': 1800.0}
IDS = list(RUNG)
TAKE_IDS = {3423, 3440, 4112, 5087, 5110, 6424, 6449, 6677, 7894}  # sql/aggregates.sql T1
SEED, B = 20261018, 10000
START = {'live': datetime(2026, 10, 1, 16, 29, 53, tzinfo=timezone.utc), 'pr5': datetime(2026, 9, 23, 15, 9, tzinfo=timezone.utc),
         'p50': datetime(2026, 9, 23, 15, 9, tzinfo=timezone.utc), 'take50': datetime(2026, 9, 23, 15, 9, tzinfo=timezone.utc),
         'd': datetime(2026, 9, 28, 0, 0, tzinfo=timezone.utc)}
WINDOWS = {'all': None, 'since_live': START['live'], 'since_1014': datetime(2026, 10, 14, 4, 2, tzinfo=timezone.utc),
           'last7': datetime(2026, 10, 11, 0, 0, tzinfo=timezone.utc)}

def ts(s): return datetime.fromisoformat(s.replace('Z', '+00:00'))
def trips(i): return R[i]['trips']

# ---- markouts: the last UK print at or before fill + 5 / 60 minutes, against the fill price, signed for the rung's side
PR = {}
for l in RPL('prints'):
    l = l.strip()
    if not l: continue
    pid, b, ms, px, q, sd = l.split('|')
    PR.setdefault(b, []).append((int(ms), float(px)))
for b in PR: PR[b].sort()
PT = {b: [p[0] for p in PR[b]] for b in PR}
def px_at(b, ms):
    k = bisect.bisect_right(PT[b], ms) - 1
    return PR[b][k][1] if k >= 0 else None
def markout(t, mins):
    e = ts(t['tEntry']).timestamp() * 1000
    p = px_at(t['book'], e + mins * 60e3)
    if p is None or e + mins * 60e3 > PT[t['book']][-1]: return None
    return 1e4 * ((p - t['entry']) / t['entry'] if t['side'] == 'bid' else (t['entry'] - p) / t['entry'])

def stats(i, frm):
    ts_ = [t for t in trips(i) if frm is None or ts(t['tEntry']) >= frm]
    real = [t for t in ts_ if t['qty'] * t['entry'] >= 1]
    pnl = sum(t['pnlGbp'] for t in ts_)
    notional = sum(t['qty'] * t['entry'] for t in ts_)
    begin = max(frm, START[i]) if frm is not None else START[i]
    days = (NOW - begin).total_seconds() / 86400
    cum = peak = mdd = 0.0
    for t in sorted(ts_, key=lambda z: z['tExit']):
        cum += t['pnlGbp']; peak = max(peak, cum); mdd = max(mdd, peak - cum)
    m5 = [x for x in (markout(t, 5) for t in real) if x is not None]
    m60 = [x for x in (markout(t, 60) for t in real) if x is not None]
    hold = sorted((ts(t['tExit']) - ts(t['tEntry'])).total_seconds() / 60 for t in real)
    return {'trips': len(ts_), 'tripsOver1Gbp': len(real), 'won': sum(t['pnlGbp'] > 0 for t in ts_), 'lost': sum(t['pnlGbp'] < 0 for t in ts_),
            'winRate': round(sum(t['pnlGbp'] > 0 for t in ts_) / len(ts_), 3) if ts_ else None,
            'stops': sum(t['how'] == 'stop' for t in ts_), 'pnlGbp': round(pnl, 4), 'feesGbp': round(sum(t['feesGbp'] for t in ts_), 4),
            'notionalGbp': round(notional, 2), 'bps': round(1e4 * pnl / notional, 2) if notional else None,
            'calendarDays': round(days, 2), 'perDayGbp': round(pnl / days, 4), 'perDayBpsOfCapital': round(1e4 * pnl / CAP[i] / days, 3),
            'aYearPct': round(100 * pnl / CAP[i] * 365 / days, 1), 'maxDrawdownGbp': round(mdd, 4),
            'dustTrips': len(ts_) - len(real), 'dustPnlGbp': round(sum(t['pnlGbp'] for t in ts_ if t['qty'] * t['entry'] < 1), 4),
            'markout5mBps': round(st.mean(m5), 2) if m5 else None, 'markout60mBps': round(st.mean(m60), 2) if m60 else None,
            'markoutN': len(m60), 'medianHoldMin': round(hold[len(hold) // 2], 1) if hold else None}

out = {'at': R['at'], 'seed': SEED, 'rungGbp': RUNG, 'capitalGbp': CAP, 'windows': {k: (v.isoformat() if v else None) for k, v in WINDOWS.items()}}
out['rows'] = {i: {w: stats(i, f) for w, f in WINDOWS.items()} for i in IDS}
out['page'] = {i: R[i]['page'] for i in IDS}
oc = {}
for r in OC:
    oc.setdefault(r['r'], {})[r['leg']] = r
out['orders'] = {i: {'entrySent': oc[i]['entry']['rows_'] - oc[i]['entry']['not_sent'], 'entryFilled': oc[i]['entry']['filled'],
                     'entryFillRate': round(oc[i]['entry']['filled'] / (oc[i]['entry']['rows_'] - oc[i]['entry']['not_sent']), 4),
                     'entryFillRate7d': round(oc[i]['entry']['filled_7d'] / oc[i]['entry']['rows_7d'], 4) if oc[i]['entry']['rows_7d'] else None,
                     'exitSent': oc[i]['exit']['rows_'] - oc[i]['exit']['not_sent'], 'exitFilled': oc[i]['exit']['filled'],
                     'refusedEntries': oc[i]['entry']['not_sent'], 'refusedExits': oc[i]['exit']['not_sent'], 'stops': oc[i]['stop']['filled']} for i in IDS}

# ---- daily P&L by entry day, in basis points of each row's capital, over the weekdays every Revolut testing row ran
def weekdays(frm, to):
    o, d = [], frm
    while d < to:
        if d.weekday() < 5: o.append(d.isoformat())
        d += timedelta(days=1)
    return o
D0, D1 = date(2026, 9, 28), date(2026, 10, 17)       # variant-3's first day to the last whole weekday
DAYS = weekdays(D0, D1)
def daily_bps(i):
    d = {}
    for t in trips(i):
        k = t['tEntry'][:10]
        d[k] = d.get(k, 0.0) + t['pnlGbp']
    return [1e4 * d.get(x, 0.0) / CAP[i] for x in DAYS]
def daily_bps_pe(s):
    row = next(r for r in PE['rows'] if r['s'] == s)
    return [1e4 * row['by_entry_day'].get(x, 0.0) / PE['capitalUsd'][s] for x in DAYS]
SER = {i: daily_bps(i) for i in IDS}
for s in PE['capitalUsd']: SER[s] = daily_bps_pe(s)

def boot_mean(xs, seed=SEED):
    rng = random.Random(seed); n = len(xs); ms = []
    for _ in range(B): ms.append(sum(xs[rng.randrange(n)] for _ in range(n)) / n)
    ms.sort()
    return round(ms[int(0.05 * B)], 3), round(ms[int(0.95 * B) - 1], 3), round(sum(1 for m in ms if m <= 0) / B, 4)

rank = {}
for k, xs in SER.items():
    m, sd = st.mean(xs), st.pstdev(xs)
    lo, hi, p0 = boot_mean(xs)
    h = len(xs) // 2
    rank[k] = {'days': len(xs), 'meanBpsDay': round(m, 3), 'p05': lo, 'p95': hi, 'sdBpsDay': round(sd, 3), 'dailySharpe': round(m / sd, 3) if sd else None,
               'aYearPct': round(m * 261 / 100, 1), 'firstHalfBpsDay': round(st.mean(xs[:h]), 3), 'secondHalfBpsDay': round(st.mean(xs[h:]), 3),
               'withoutBestDayBpsDay': round((sum(xs) - max(xs)) / (len(xs) - 1), 3), 'bestDay': DAYS[xs.index(max(xs))], 'daysBelow0': sum(1 for x in xs if x < 0)}
out['rankingWindow'] = {'from': DAYS[0], 'to': DAYS[-1], 'weekdays': len(DAYS), 'basis': 'P&L by entry day over the row\'s capital, bps a weekday; weekends carry none for these rows (dark)'}
out['ranking'] = dict(sorted(rank.items(), key=lambda kv: -kv[1]['meanBpsDay']))

pairs = [('p50', 'pr5'), ('take50', 'p50'), ('take50', 'pr5'), ('d', 'p50'), ('d', 'take50'), ('take50', 'd'),
         ('pr5v_main', 'pr5_paper'), ('ruled_d', 'ruled_v1'), ('pr5v_top5', 'pr5_paper'), ('p50', 'pr5_paper')]
out['pairs'] = {}
for a, b in pairs:
    diffs = [x - y for x, y in zip(SER[a], SER[b])]
    m, sd = st.mean(diffs), st.pstdev(diffs)
    lo, hi, p0 = boot_mean(diffs)
    need = round((1.645 * sd / abs(m)) ** 2, 1) if m and sd else None
    out['pairs'][f'{a} - {b}'] = {'meanBpsDay': round(m, 3), 'p05': lo, 'p95': hi, 'shareAtOrBelow0': p0, 'sdBpsDay': round(sd, 3), 'weekdaysNeeded95': need,
                                  'daysAhead': sum(1 for x in diffs if x > 1e-9), 'daysBehind': sum(1 for x in diffs if x < -1e-9)}

# ---- TAKE's takes so far
tk = [t for t in trips('take50') if any(x in TAKE_IDS for x in t['ids'])]
out['takes'] = {'n': len(tk), 'pnlGbp': round(sum(t['pnlGbp'] for t in tk), 4), 'won': sum(t['pnlGbp'] > 0 for t in tk),
                'list': [{k: t[k] for k in ('book', 'side', 'k', 'tEntry', 'tExit', 'pnlGbp', 'feesGbp')} for t in tk]}

# ---- LIVE by day (entry day), and since the last review
lv = {}
for t in trips('live'):
    k = t['tEntry'][:10]; c = lv.setdefault(k, {'trips': 0, 'over1': 0, 'pnlGbp': 0.0})
    c['trips'] += 1; c['pnlGbp'] = round(c['pnlGbp'] + t['pnlGbp'], 4)
    if t['qty'] * t['entry'] >= 1: c['over1'] += 1
out['liveByDay'] = dict(sorted(lv.items()))

json.dump(out, open(os.path.join(HERE, 'results', 'compare.json'), 'w'), indent=1, default=str)
for i in IDS:
    for w in WINDOWS:
        s = out['rows'][i][w]
        print(f"{i:7} {w:10} trips {s['trips']:4} (>£1 {s['tripsOver1Gbp']:3}) win {s['winRate']} £ {s['pnlGbp']:+8.4f} /day {s['perDayGbp']:+.4f} yr {s['aYearPct']}% dd {s['maxDrawdownGbp']} mk5 {s['markout5mBps']} mk60 {s['markout60mBps']} hold {s['medianHoldMin']}")
print(json.dumps(out['orders'], indent=0))
for k, v in out['ranking'].items(): print('RANK', k, v)
for k, v in out['pairs'].items(): print('PAIR', k, v)
print('takes', {k: v for k, v in out['takes'].items() if k != 'list'})
