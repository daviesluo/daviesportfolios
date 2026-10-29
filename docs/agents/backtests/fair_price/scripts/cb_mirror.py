# REVX-FAIR addendum (2026-10-29): scores cb_mirror.ts's runs, the USDC-GBP lead mirrored onto Coinbase at -3's $50 a rung.
#
# First the reproduction: the replay's base, in pounds as the records ran, against the engines' own trips (data/
# cb_engine_trips_USDC-GBP.txt: "with Euros - 1" (cb_hold, £100 a rung, from 10-13) and "- 2" (cb_usdc, £25, from 10-27)).
# Then each nudge against the base, paired by UTC exit day over 2026-10-11 -> 10-29 (10-10 warms the EMA), in bps of the
# $300 a day; a circular 3-day block bootstrap, 10,000 resamples, seed 20261029, 90 % and P(<= 0); halves 10-11 -> 10-20 |
# 10-20 -> 10-29; trips, per-trip bps, and the pnl of trips entered inside an FX closure apart.
#   python3 -I scripts/cb_mirror.py      (after cb_mirror.ts)
import os, sys, json, random, statistics as st, collections, datetime
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fp_data as D

DAY = D.DAY
CAP = 300.0
T0, T1, SPLIT = D.ms(2026, 10, 11), D.ms(2026, 10, 29), D.ms(2026, 10, 20)
SEED, NB, BLOCK = 20261029, 10000, 3


def boot(v, seed=SEED):
    n = len(v); rnd = random.Random(seed); out = []
    for _ in range(NB):
        s = []
        while len(s) < n:
            i = rnd.randrange(n); s.extend(v[(i + j) % n] for j in range(BLOCK))
        out.append(st.fmean(s[:n]))
    out.sort()
    return [round(out[int(0.05 * NB)], 3), round(out[int(0.95 * NB)], 3), round(sum(1 for x in out if x <= 0) / NB, 4)]


def daily(trips):
    d = collections.OrderedDict((t, 0.0) for t in range(T0, T1, DAY))
    for x in trips:
        if x['tExit'] < T0: continue
        k = (min(x['tExit'], T1 - 1) - T0) // DAY * DAY + T0
        d[k] += x['pnl']
    return d


def summ(trips):
    tr = [x for x in trips if x['tExit'] >= T0]
    d = daily(tr)
    return {'bpsDay': round(sum(d.values()) / CAP * 1e4 / len(d), 3), 'trips': len(tr), 'stops': sum(1 for x in tr if x['how'] == 'taker'),
            'open': sum(1 for x in tr if x['how'] == 'open'),
            'perTripBps': round(1e4 * sum(x['pnl'] for x in tr) / max(1e-9, sum(x['notional'] for x in tr)), 2),
            'closureEntryBpsDay': round(sum(x['pnl'] for x in tr if D.closure(x['tEntry'])) / CAP * 1e4 / len(d), 3),
            'weekdayEntryBpsDay': round(sum(x['pnl'] for x in tr if not D.closure(x['tEntry'])) / CAP * 1e4 / len(d), 3)}


def main():
    R = json.load(open(os.path.join(HERE, 'results', 'cb_mirror_trips.json')))
    out = {'window': ['2026-10-11', '2026-10-29', '2026-10-20'], 'capitalUsd': CAP, 'runs': {}, 'repro': {}}
    # reproduction
    rec = collections.defaultdict(list)
    for l in D._open('cb_engine_trips_USDC-GBP.txt'):
        l = l.strip()
        if not l: continue
        src, side, k, te, tx, entry, exit_, how, qty, pnl = l.split('|')
        rec[src].append((side, round(float(k), 4), int(te), int(tx), round(float(entry), 6), round(float(exit_), 6), how, float(qty), float(pnl)))
    for name, src in (('repro_hold', 'hold'), ('repro_usdc', 'usdc')):
        mine = [(x['side'], round(x['k'], 4), x['tEntry'], x['tExit'], round(x['entry'], 6), round(x['exit'], 6), x['how'], x['qty'], x['pnl']) for x in R[name]['trips']]
        a = {z[:7] for z in mine}; b = {z[:7] for z in rec[src]}
        out['repro'][name] = {'replay': len(mine), 'record': len(rec[src]), 'same_trip': len(a & b), 'replay_only': sorted(a - b)[:10], 'record_only': sorted(b - a)[:10],
                              'pnl_replay': round(sum(z[8] for z in mine), 4), 'pnl_record': round(sum(z[8] for z in rec[src]), 4)}
        print(name, out['repro'][name]['replay'], out['repro'][name]['record'], out['repro'][name]['same_trip'], out['repro'][name]['pnl_replay'], out['repro'][name]['pnl_record'])
    base = R['base']['trips']
    db = daily(base)
    out['runs']['base'] = {**summ(base), 'orders': R['base']['orders'], 'refused': R['base']['refused']}
    print('base', out['runs']['base'])
    keys = list(db)
    for name, r in R.items():
        if name in ('base', 'repro_hold', 'repro_usdc'): continue
        dc = daily(r['trips'])
        diff = [(dc[k] - db[k]) / CAP * 1e4 for k in keys]
        h1 = [x for k, x in zip(keys, diff) if k < SPLIT]; h2 = [x for k, x in zip(keys, diff) if k >= SPLIT]
        res = {**summ(r['trips']), 'orders': r['orders'], 'refused': r['refused'], 'nudgedMinutes': r['nudged'],
               'diffBpsDay': round(st.fmean(diff), 3), 'boot90_pLe0': boot(diff), 'h1': round(st.fmean(h1), 3), 'h2': round(st.fmean(h2), 3),
               'h1_boot90_pLe0': boot(h1), 'h2_boot90_pLe0': boot(h2), 'daysAhead': sum(1 for x in diff if x > 1e-9), 'daysBehind': sum(1 for x in diff if x < -1e-9)}
        out['runs'][name] = res
        print(name, res['bpsDay'], res['trips'], res['perTripBps'], res['diffBpsDay'], res['boot90_pLe0'], res['h1'], res['h2'], res['closureEntryBpsDay'], res['weekdayEntryBpsDay'])
    json.dump(out, open(os.path.join(HERE, 'results', 'cb_mirror.json'), 'w'), indent=1, sort_keys=True)


if __name__ == '__main__':
    main()
