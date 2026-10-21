# The placement-timing question (Davies, 2026-10-21: "Would adjusting the order timing be better? If it improves things, change
# it."): the LIVE-faithful replay (LIVE's fill rule and operations) with LIVE's turn at 30 s into the call minute, against the
# same with the turn at the minute's start (the paper's live_at) and at 10 s. Per arm: round trips, fills, realised pounds by
# the page's functions (results/trips_<arm>.json), and the account's value at the end (its balances at the last prints); the
# difference from the 30 s arm by the UTC day each trip closed, with a day bootstrap (10,000 draws, seed 20261021).
#   python3 -I scripts/timing.py     (after replay.ts at_ops / at_ops_t0 / at_ops_t10 and trips.ts on each)
import gzip, json, os, random
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = lambda f: json.load(open(os.path.join(here, 'results', f)))
run = lambda n: json.load(gzip.open(os.path.join(here, 'results', 'runs', f'{n}.json.gz')))
last = {}
for l in gzip.open(os.path.join(here, '..', 'pr5_review', 'data', 'prints.txt.gz'), 'rt'):
    if l.strip():
        i, b, t, p, q, s = l.strip().split('|'); last[b] = float(p)
value = lambda bal: bal.get('GBP', 0) + bal.get('USDC', 0) * last['USDC-GBP'] + bal.get('USDT', 0) * last['USDT-GBP']
base = 'at_ops'
out = {'base': base, 'base_turn_s': 30, 'arms': {}}
B = R(f'trips_{base}.json'); Bv = value(run(base)['balances'])
for arm, sec in (('at_ops_t0', 0), ('at_ops_t10', 10)):
    A = R(f'trips_{arm}.json'); Av = value(run(arm)['balances'])
    days = sorted(set(A['byDay']['sim']) | set(B['byDay']['sim']))
    diff = [A['byDay']['sim'].get(d, 0) - B['byDay']['sim'].get(d, 0) for d in days]
    rng = random.Random(20261021)
    boots = sorted(sum(rng.choice(diff) for _ in diff) for _ in range(10000))
    cmpA, cmpB = R(f'compare_{arm}.json'), R(f'compare_{base}.json')
    out['arms'][arm] = {
        'turn_s': sec, 'trips': A['sim']['trips'], 'won': A['sim']['won'], 'realised_gbp': A['sim']['realisedGbp'],
        'realised_minus_base_gbp': round(A['sim']['realisedGbp'] - B['sim']['realisedGbp'], 4),
        'end_value_minus_base_gbp': round(Av - Bv, 4),
        'fills': cmpA['fills']['sim'], 'fills_base': cmpB['fills']['sim'],
        'by_day_minus_base': {d: round(x, 4) for d, x in zip(days, diff)},
        'bootstrap': {'days': len(days), 'p05': round(boots[500], 4), 'p50': round(boots[5000], 4), 'p95': round(boots[9500], 4), 'share_le_0': round(sum(1 for b in boots if b <= 0) / 10000, 4)},
    }
out['base_trips'], out['base_realised_gbp'] = B['sim']['trips'], B['sim']['realisedGbp']
json.dump(out, open(os.path.join(here, 'results', 'timing.json'), 'w'), indent=1, sort_keys=True)
print(json.dumps({k: {kk: v for kk, v in a.items() if kk != 'by_day_minus_base'} for k, a in out['arms'].items()}, indent=1))
