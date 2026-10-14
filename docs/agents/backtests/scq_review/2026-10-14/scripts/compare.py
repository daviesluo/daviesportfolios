# 2026-10-14 stablecoin quotes review: every row on one basis, TAKE's gap taken apart, paired day bootstraps.
# Reads results/page_pnl.json (the page's own trips, scripts/page_pnl.ts) and writes results/compare.json.
# python3 -I scripts/compare.py   (from this folder)
import json, random, os
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = json.load(open(os.path.join(HERE, 'results', 'page_pnl.json')))
NOW = datetime.fromisoformat(R['at'].replace('Z', '+00:00'))
RUNG = {'live': 10.0, 'pr5': 100.0, 'p50': 50.0, 'take50': 50.0, 'd': 50.0}
CAP = {'live': 120.0, 'pr5': 1200.0, 'p50': 600.0, 'take50': 600.0, 'd': 1800.0}
IDS = list(RUNG)
TAKE_IDS = {3423, 3440, 4112, 5087, 5110}  # take50's IOC takes (request.take), sql/aggregates.sql T1
SEED = 20261014
WINDOWS = {
    'all': None,
    'since_live': datetime(2026, 10, 1, 16, 29, 53, tzinfo=timezone.utc),  # LIVE's first minute
    'since_take': datetime(2026, 10, 4, 16, 0, tzinfo=timezone.utc),       # TAKE's window (Addendum 1)
    'since_1009': datetime(2026, 10, 9, 16, 0, tzinfo=timezone.utc),       # after the 2026-10-09 review's read
}

def ts(s): return datetime.fromisoformat(s.replace('Z', '+00:00'))
def trips(i): return R[i]['trips']
def start_of(i):
    t = trips(i)
    return min(ts(x['tEntry']) for x in t) if t else NOW

def stats(i, frm):
    ts_ = [t for t in trips(i) if frm is None or ts(t['tEntry']) >= frm]
    pnl = sum(t['pnlGbp'] for t in ts_)
    notional = sum(t['qty'] * t['entry'] for t in ts_)
    dust = [t for t in ts_ if t['qty'] * t['entry'] < 1]
    by_day = {}
    for t in ts_:
        d = t['tExit'][:10]
        by_day[d] = by_day.get(d, 0.0) + t['pnlGbp']
    begin = frm if frm is not None else start_of(i)
    if i == 'live' and frm is None: begin = WINDOWS['since_live']
    days = (NOW - begin).total_seconds() / 86400
    lit = sum(1 for k in range(int(days) + 2) if (begin + timedelta(days=k)).date() <= NOW.date() and (begin + timedelta(days=k)).weekday() < 5)
    return {
        'trips': len(ts_), 'won': sum(t['pnlGbp'] > 0 for t in ts_), 'lost': sum(t['pnlGbp'] < 0 for t in ts_),
        'stops': sum(t['how'] == 'stop' for t in ts_), 'pnlGbp': round(pnl, 4),
        'feesGbp': round(sum(t['feesGbp'] for t in ts_), 4), 'notionalGbp': round(notional, 2),
        'bps': round(1e4 * pnl / notional, 2) if notional else None,
        'pnlPerPoundOfRung': round(pnl / RUNG[i], 5),
        'pctOfCapital': round(100 * pnl / CAP[i], 3),
        'calendarDays': round(days, 2), 'litWeekdays': lit,
        'aYearOnCapitalPct': round(100 * pnl / CAP[i] * 365 / days, 1) if days > 0 else None,
        'perLitDayPerPoundOfRung': round(pnl / RUNG[i] / lit, 5) if lit else None,
        'worstDay': min(by_day.items(), key=lambda kv: kv[1]) if by_day else None,
        'bestDay': max(by_day.items(), key=lambda kv: kv[1]) if by_day else None,
        'dustTrips': len(dust), 'dustPnlGbp': round(sum(t['pnlGbp'] for t in dust), 4),
        'withoutDustPnlGbp': round(pnl - sum(t['pnlGbp'] for t in dust), 4),
    }

out = {'at': R['at'], 'seed': SEED, 'rungGbp': RUNG, 'capitalGbp': CAP, 'windows': {k: (v.isoformat() if v else None) for k, v in WINDOWS.items()}}
out['rows'] = {i: {w: stats(i, f) for w, f in WINDOWS.items()} for i in IDS}
out['page'] = {i: R[i]['page'] for i in IDS}
out['fills'] = {i: {k: R[i][k] for k in ('fills', 'entryFills', 'exitFills', 'stopFills', 'takeFills', 'conversionFeesGbp')} for i in IDS}

# TAKE apart: take50 against p50, the same decisions at the same size but for the takes.
def key(t): return (t['book'], t['side'], t['k'], t['tEntry'])
tk = trips('take50'); pk = trips('p50')
take_trips = [t for t in tk if any(x in TAKE_IDS for x in t['ids'])]
pk_keys = {key(t): t for t in pk}; tk_keys = {key(t): t for t in tk}
common = [k for k in tk_keys if k in pk_keys]
only_take = [tk_keys[k] for k in tk_keys if k not in pk_keys and not any(x in TAKE_IDS for x in tk_keys[k]['ids'])]
only_p50 = [pk_keys[k] for k in pk_keys if k not in tk_keys]
diff_common = [tk_keys[k]['pnlGbp'] - pk_keys[k]['pnlGbp'] for k in common]
out['take_vs_p50'] = {
    'pageRealisedGap': round(R['take50']['page']['realisedGbp'] - R['p50']['page']['realisedGbp'], 4),
    'tripsGap': round(sum(t['pnlGbp'] for t in tk) - sum(t['pnlGbp'] for t in pk), 4),
    'takeTrips': [{k: t[k] for k in ('book', 'side', 'k', 'tEntry', 'tExit', 'entry', 'exit', 'qty', 'how', 'feesGbp', 'pnlGbp')} for t in take_trips],
    'takeTripsPnlGbp': round(sum(t['pnlGbp'] for t in take_trips), 4),
    'commonTrips': len(common), 'commonTripsPnlGap': round(sum(diff_common), 4),
    'commonTripsDiffering': sum(1 for d in diff_common if abs(d) > 1e-9),
    'onlyTakeNonTakeTrips': len(only_take), 'onlyTakeNonTakePnl': round(sum(t['pnlGbp'] for t in only_take), 4),
    'onlyP50Trips': len(only_p50), 'onlyP50Pnl': round(sum(t['pnlGbp'] for t in only_p50), 4),
    'onlyTakeList': [{k: t[k] for k in ('book', 'side', 'k', 'tEntry', 'tExit', 'qty', 'pnlGbp')} for t in only_take],
    'onlyP50List': [{k: t[k] for k in ('book', 'side', 'k', 'tEntry', 'tExit', 'qty', 'pnlGbp')} for t in only_p50],
    'commonDifferingList': [{'key': list(k), 'take50': round(tk_keys[k]['pnlGbp'], 4), 'p50': round(pk_keys[k]['pnlGbp'], 4),
                             'take50Exit': tk_keys[k]['tExit'], 'p50Exit': pk_keys[k]['tExit']} for k in common if abs(tk_keys[k]['pnlGbp'] - pk_keys[k]['pnlGbp']) > 1e-9],
}

# Paired day bootstraps on the weekdays both rows were lit, trips by their entry day (as TAKE's C3), each row per £ of
# rung scaled to £50 (so take50 and p50 are in their own pounds, pr5 halved, LIVE times five).
def daily(i, frm, to):
    d = {}
    for t in trips(i):
        e = ts(t['tEntry'])
        if e < frm or e >= to: continue
        k = t['tEntry'][:10]
        d[k] = d.get(k, 0.0) + t['pnlGbp'] * 50.0 / RUNG[i]
    return d

def weekdays(frm, to):
    out_, d = [], frm.date()
    while d < to.date() or (d == to.date() and to.time() != datetime.min.time()):
        if d.weekday() < 5: out_.append(d.isoformat())
        d += timedelta(days=1)
    return out_

def boot(a, b, frm, to, label):
    da, db = daily(a, frm, to), daily(b, frm, to)
    days = weekdays(frm, to)
    diffs = [da.get(x, 0.0) - db.get(x, 0.0) for x in days]
    rng = random.Random(SEED)
    n = len(diffs); means = []
    for _ in range(10000):
        means.append(sum(diffs[rng.randrange(n)] for _ in range(n)) / n)
    means.sort()
    return {'label': label, 'a': a, 'b': b, 'from': frm.isoformat(), 'to': to.isoformat(), 'days': n,
            'dailyDiffs': {x: round(y, 4) for x, y in zip(days, diffs)},
            'sumA_at50': round(sum(da.get(x, 0.0) for x in days), 4), 'sumB_at50': round(sum(db.get(x, 0.0) for x in days), 4),
            'meanDiffPerDay_at50': round(sum(diffs) / n, 4), 'p05': round(means[499], 4), 'p95': round(means[9499], 4),
            'shareAtOrBelow0': round(sum(1 for m in means if m <= 0) / len(means), 4),
            'daysAhead': sum(1 for x in diffs if x > 1e-9), 'daysBehind': sum(1 for x in diffs if x < -1e-9)}

END = datetime(2026, 10, 14, 0, 0, tzinfo=timezone.utc)  # whole days only
T0 = datetime(2026, 9, 24, 0, 0, tzinfo=timezone.utc)
TK = datetime(2026, 10, 5, 0, 0, tzinfo=timezone.utc)  # TAKE's first whole weekday
LV = datetime(2026, 10, 2, 0, 0, tzinfo=timezone.utc)  # LIVE's first whole weekday
out['bootstraps'] = [
    boot('take50', 'p50', TK, END, 'variant-2 minus variant-1, TAKE\'s weekdays (£)'),
    boot('take50', 'pr5', TK, END, 'variant-2 minus Stablecoin quotes at £50 a rung, TAKE\'s weekdays'),
    boot('take50', 'pr5', T0, END, 'variant-2 minus Stablecoin quotes at £50 a rung, every weekday'),
    boot('p50', 'pr5', T0, END, 'variant-1 minus Stablecoin quotes at £50 a rung, every weekday (size alone)'),
    boot('p50', 'pr5', TK, END, 'variant-1 minus Stablecoin quotes at £50 a rung, TAKE\'s weekdays (size alone)'),
    boot('live', 'pr5', LV, END, 'LIVE minus Stablecoin quotes, both at £50 a rung, LIVE\'s weekdays'),
    boot('live', 'p50', LV, END, 'LIVE minus variant-1, both at £50 a rung, LIVE\'s weekdays'),
]

# The rule alone: each weekday's take trips less the p50 trips no take50 trip matches (the maker trips a take displaced),
# by entry day, leaving out the common trips whose exits differ (the twins' turn timing, not the rule).
rule_daily = {}
for t in take_trips: rule_daily[t['tEntry'][:10]] = rule_daily.get(t['tEntry'][:10], 0.0) + t['pnlGbp']
for t in only_take: rule_daily[t['tEntry'][:10]] = rule_daily.get(t['tEntry'][:10], 0.0) + t['pnlGbp']
for t in only_p50: rule_daily[t['tEntry'][:10]] = rule_daily.get(t['tEntry'][:10], 0.0) - t['pnlGbp']
days = weekdays(TK, END)
diffs = [rule_daily.get(x, 0.0) for x in days]
rng = random.Random(SEED); means = []
for _ in range(10000): means.append(sum(diffs[rng.randrange(len(diffs))] for _ in range(len(diffs))) / len(diffs))
means.sort()
out['takeRuleOnly'] = {'days': len(days), 'dailyDiffs': {x: round(y, 4) for x, y in zip(days, diffs)}, 'sum': round(sum(diffs), 4),
                       'meanPerDay': round(sum(diffs) / len(diffs), 4), 'p05': round(means[499], 4), 'p95': round(means[9499], 4),
                       'shareAtOrBelow0': round(sum(1 for m in means if m <= 0) / len(means), 4),
                       'takesSoFar': len(take_trips), 'lastTake': max(t['tEntry'] for t in take_trips) if take_trips else None}
print('take rule only:', {k: v for k, v in out['takeRuleOnly'].items() if k != 'dailyDiffs'})

# By rung over LIVE's span, per £ of rung: which books and sides earn.
rungs = {}
for i in ('live', 'pr5', 'p50', 'd'):
    for t in trips(i):
        if ts(t['tEntry']) < WINDOWS['since_live']: continue
        k = f"{t['book']}|{t['side']}|{t['k']}"
        r = rungs.setdefault(k, {})
        c = r.setdefault(i, {'trips': 0, 'pnlPerPoundOfRung': 0.0, 'dust': 0})
        c['trips'] += 1; c['pnlPerPoundOfRung'] += t['pnlGbp'] / RUNG[i]
        if t['qty'] * t['entry'] < 1: c['dust'] += 1
for k in rungs:
    for i in rungs[k]: rungs[k][i]['pnlPerPoundOfRung'] = round(rungs[k][i]['pnlPerPoundOfRung'], 5)
out['byRungSinceLive'] = dict(sorted(rungs.items()))

json.dump(out, open(os.path.join(HERE, 'results', 'compare.json'), 'w'), indent=1, default=str)
for i in IDS:
    for w in ('all', 'since_live', 'since_take', 'since_1009'):
        s = out['rows'][i][w]
        print(f"{i:7} {w:10} trips {s['trips']:4} won {s['won']:4} stops {s['stops']:2} £ {s['pnlGbp']:+8.4f} bps {s['bps']} "
              f"per£rung {s['pnlPerPoundOfRung']:+.5f} yr {s['aYearOnCapitalPct']}% lit {s['litWeekdays']} worst {s['worstDay']} dust {s['dustTrips']} {s['dustPnlGbp']:+.4f}")
tv = out['take_vs_p50']
print('take vs p50:', {k: tv[k] for k in tv if not k.endswith('List') and k != 'takeTrips'})
for b in out['bootstraps']:
    print(b['label'], '| days', b['days'], 'mean/day', b['meanDiffPerDay_at50'], '[', b['p05'], b['p95'], '] P(<=0)', b['shareAtOrBelow0'], 'ahead/behind', b['daysAhead'], b['daysBehind'])
