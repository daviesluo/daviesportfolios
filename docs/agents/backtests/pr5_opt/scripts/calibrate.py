# PR5-OPT: is sim.py LIVE-realistic? Replays LIVE's own life at its own size (£120, £10 a rung) and compares with LIVE's
# filled orders (the 2026-10-26 review's committed pull, ../scq_review/2026-10-26/data/live_orders.json.gz), day by day and rung by
# rung, 2026-10-02 00:00 -> 2026-10-26 00:00 UTC. LIVE quoted weekends from 2026-10-23 21:00 (weekend_mode 'live'), so the
# replay holds X through a closure only from then. Public repository: LIVE is reported in bps of its capital, never in pounds.
# `cleanDaysRatio` leaves out LIVE's four operational days (ledger and the 2026-10-21 sim-vs-live audit): 10-02 (the database
# stall 12:17-14:12 and the go-live conversions), 10-07 (the governor reached 950 POSTs; dead-man cancels with the state unreadable),
# 10-08 (the three 24-hour stops of what 10-07 left held) and 10-20 (Revolut X's outage: six rungs' cancels frozen 6 h 25 min).
# Writes results/calibration.json.   python3 -I scripts/calibrate.py
import os, sys, json, gzip, collections, datetime, statistics as st
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim

HERE = sim.HERE
T0 = int(datetime.datetime(2026, 10, 2, tzinfo=datetime.timezone.utc).timestamp() * 1000)
T1 = int(datetime.datetime(2026, 10, 26, tzinfo=datetime.timezone.utc).timestamp() * 1000)
WK = int(datetime.datetime(2026, 10, 23, 21, tzinfo=datetime.timezone.utc).timestamp() * 1000)
CAP = 120.0
day = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime('%Y-%m-%d')
iso2ms = lambda s: int(datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)


def live_trips():
    orders = json.loads(gzip.open(os.path.join(HERE, '..', 'scq_review', '2026-10-26', 'data', 'live_orders.json.gz')).read())
    rungs = collections.defaultdict(list)
    for x in orders:
        if x['leg'] in ('entry', 'exit', 'stop') and float(x['filled_base'] or 0) > 0:
            rungs[(x['book'], x['rung_side'], round(float(x['k']), 4))].append(x)
    trips, entries = [], []
    for key, fs in rungs.items():
        fs.sort(key=lambda x: (x['filled_at'] or x['ts'], x['id']))
        pos = cash = gbp = 0.0; opened = None
        for f in fs:
            q, p, fee = float(f['filled_base']), float(f['avg_fill_price'] or f['price']), float(f['fee_gbp'] or 0)
            ts = iso2ms(f['filled_at'] or f['ts'])
            sgn = 1 if f['side'] == 'buy' else -1
            if f['leg'] == 'entry':
                entries.append({'book': key[0], 'side': key[1], 'k': key[2], 'ts': ts, 'filledShare': q / float(f['base_size'])})
                if opened is None: opened = ts
                gbp += q * p
            pos += sgn * q
            cash += -sgn * q * p - fee
            if abs(pos) < sim.DUST:
                trips.append({'book': key[0], 'side': key[1], 'k': key[2], 'tEntry': opened or ts, 'tExit': ts, 'pnl': cash + pos * p,
                              'gbp': gbp, 'how': 'taker' if f['leg'] == 'stop' else 'maker'})
                cash = -pos * p; opened = None; gbp = 0.0
    return trips, entries


def by_day(trips, days):
    d = collections.Counter()
    for t in trips:
        if T0 <= t['tExit'] < T1: d[day(t['tExit'])] += t['pnl']
    return [d.get(x, 0.0) for x in days]


def by_rung(trips):
    out = collections.defaultdict(lambda: [0, 0.0])
    for t in trips:
        if T0 <= t['tExit'] < T1:
            k = f"{t['book']}|{t['side']}|{t['k']}"; out[k][0] += 1; out[k][1] += t['pnl']
    return out


if __name__ == '__main__':
    mins, prints = sim.load_fwd()
    days = [day(T0 + i * sim.DAY) for i in range((T1 - T0) // sim.DAY)]
    lt, le = live_trips()
    res = {'window': [day(T0), day(T1)], 'days': len(days), 'note': 'bps of capital; LIVE in bps only (public repository)'}
    L = by_day(lt, days)
    res['live'] = {'trips': sum(1 for t in lt if T0 <= t['tExit'] < T1), 'bpsDay': round(1e4 * sum(L) / CAP / len(days), 3),
                   'entryFills': sum(1 for e in le if T0 <= e['ts'] < T1),
                   'entryFilledShareMean': round(st.mean(e['filledShare'] for e in le if T0 <= e['ts'] < T1), 3)}
    for name, kw in {'at': {}, 'at_half': {'at_share': 0.5}, 'through': {'fill': 'through'}, 'at_off10': {'off_s': 10}}.items():
        tr, cap = sim.run(mins, prints, T0 - 2 * sim.DAY, T1, capital=CAP, xhold_from=WK, **kw)
        tr = [t for t in tr if t['how'] != 'open']
        S = by_day(tr, days)
        corr = st.correlation(S, L) if len(set(S)) > 1 else None
        res[name] = {'trips': sum(1 for t in tr if T0 <= t['tExit'] < T1), 'bpsDay': round(1e4 * sum(S) / CAP / len(days), 3),
                     'ratioToLive': round(sum(S) / sum(L), 3), 'dailyCorrelation': round(corr, 3) if corr else None,
                     'weekdaysRatio': round(sum(s for s, d_ in zip(S, days) if datetime.date.fromisoformat(d_).weekday() < 5) /
                                            sum(l for l, d_ in zip(L, days) if datetime.date.fromisoformat(d_).weekday() < 5), 3)}
        ops = {'2026-10-02', '2026-10-07', '2026-10-08', '2026-10-20'}
        res[name]['cleanDaysRatio'] = round(sum(s for s, d_ in zip(S, days) if d_ not in ops) / sum(l for l, d_ in zip(L, days) if d_ not in ops), 3)
        if name == 'at':
            res['byRung'] = {k: {'sim': [v[0], round(1e4 * v[1] / CAP, 2)], 'live': [by_rung(lt)[k][0], round(1e4 * by_rung(lt)[k][1] / CAP, 2)]}
                             for k, v in sorted(by_rung(tr).items())}
            res['daily'] = {d_: {'simBps': round(1e4 * s / CAP, 2), 'liveBps': round(1e4 * l / CAP, 2)} for d_, s, l in zip(days, S, L)}
        print(name, res[name])
    print('live', res['live'])
    json.dump(res, open(os.path.join(HERE, 'results', 'calibration.json'), 'w'), indent=1)
