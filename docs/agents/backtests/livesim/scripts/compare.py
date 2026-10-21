# LIVE's own orders and fills (data/live_orders.txt) against the simulation's (results/runs/<name>.json.gz), from LIVE's
# go-live (2026-10-01 16:29:53) to 2026-10-21 15:09 UTC. Writes results/compare_<name>.json.
#   python3 -I scripts/compare.py <name>
# Orders are matched one to one on (book, rung side, k, leg, side, price), the nearest in time within 120 s; entries also
# by the paper decision they carry out (paper_oid). A fill matches when both orders of a matched pair filled, within 1 % of
# each other's coins and 10 minutes of each other's booking. LIVE's fills the simulation lacks are classed by the public
# prints between the order's placement and its booked fill: a print THROUGH its price, prints only AT it from the other side
# (the simulation's rule fills nothing there), or neither.
import gzip, json, os, sys, collections, datetime
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
name = sys.argv[1]
T0, T1 = 1790872193000, 1792595340000          # 2026-10-01 16:29:53, 2026-10-21 15:09
iso = lambda t: datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime('%m-%d %H:%M:%S') if t else None
live = [json.loads(l) for l in gzip.open(os.path.join(here, 'data', 'live_orders.txt.gz'), 'rt') if l.strip()]
live = [o for o in live if T0 <= o['ts'] < T1]
run = json.load(gzip.open(os.path.join(here, 'results', 'runs', f'{name}.json.gz')))
C = ['id', 'ts', 'book', 'rung_side', 'k', 'leg', 'side', 'state', 'price', 'base_size', 'filled_base', 'avg_fill_price', 'fee_gbp', 'filled_at', 'not_sent', 'cancel_requested_at', 'cancelled_at', 'fair', 'cancel_reason', 'paper_oid']
sim = [dict(zip(C, r)) for r in run['orders']]
sim = [o for o in sim if T0 <= o['ts'] < T1]
prints = collections.defaultdict(list)
for l in gzip.open(os.path.join(here, '..', 'pr5_review', 'data', 'prints.txt.gz'), 'rt'):
    if not l.strip(): continue
    i, b, t, p, q, s = l.strip().split('|'); prints[b].append((int(t), round(float(p) / 1e-4), float(q), s))
f = lambda x: float(x or 0)
sent = lambda o: not o.get('not_sent')
key = lambda o: (o['book'], o['rung_side'], round(f(o['k']), 4) if o['k'] is not None else None, o['leg'], o['side'], round(f(o['price']) / 1e-4))


def pair(A, B, tol=120_000):
    """One to one, nearest in time within tol, on `key`."""
    pool = collections.defaultdict(list)
    for j, b in enumerate(B): pool[key(b)].append(j)
    used, pairs = set(), []
    for i, a in enumerate(A):
        best = None
        for j in pool[key(a)]:
            if j in used: continue
            d = abs(B[j]['ts'] - a['ts'])
            if d <= tol and (best is None or d < best[0]): best = (d, j)
        if best: used.add(best[1]); pairs.append((i, best[1]))
    return pairs


L, S = [o for o in live if sent(o)], [o for o in sim if sent(o)]
P = pair(L, S)
mL, mS = {i for i, _ in P}, {j for _, j in P}
by_leg = lambda rows, idx: collections.Counter(rows[i]['leg'] for i in idx)
R = {'name': name, 'rules': run.get('rules'), 'window': [iso(T0), iso(T1)], 'sim_errors': run.get('errors'), 'sim_realised_gbp': round(run['realisedGbp'], 4),
     'orders': {'live': len(L), 'sim': len(S), 'matched': len(P), 'recall': round(len(P) / len(L), 4), 'precision': round(len(P) / len(S), 4),
                'live_by_leg': dict(collections.Counter(o['leg'] for o in L)), 'sim_by_leg': dict(collections.Counter(o['leg'] for o in S)),
                'matched_by_leg': dict(by_leg(L, mL))}}
# Entries by the paper decision they carry out.
dec = lambda o: (o['book'], o['rung_side'], round(f(o['k']), 4), o['paper_oid'])
le = {dec(o) for o in L if o['leg'] == 'entry' and o['paper_oid'] is not None and not o.get('take')}
se = {dec(o) for o in S if o['leg'] == 'entry' and o['paper_oid'] is not None}
R['entry_decisions'] = {'live': len(le), 'sim': len(se), 'both': len(le & se), 'jaccard': round(len(le & se) / len(le | se), 4)}
# Fills.
filled = lambda o: f(o['filled_base']) > 0
LF = [i for i, o in enumerate(L) if filled(o)]
SF = [j for j, o in enumerate(S) if filled(o)]
fm = [(i, j) for i, j in P if filled(L[i]) and filled(S[j]) and abs(f(L[i]['filled_base']) - f(S[j]['filled_base'])) <= 0.01 * max(f(L[i]['filled_base']), 1e-9)
      and abs((L[i]['filled_at'] or 0) - (S[j]['filled_at'] or 0)) <= 600_000]
fmL, fmS = {i for i, _ in fm}, {j for _, j in fm}
pmatch = {i: j for i, j in P}


def cls(o):
    side, px = o['side'], round(f(o['price']) / 1e-4)
    t0, t1 = o['ts'], o['filled_at'] or o['ts']
    ps = [p for p in prints[o['book']] if t0 < p[0] <= t1]
    thr = [p for p in ps if (p[1] > px if side == 'sell' else p[1] < px)]
    at = [p for p in ps if p[1] == px and p[3] == ('buy' if side == 'sell' else 'sell')]
    return 'through' if thr else ('at only' if at else 'neither')


live_only = []
for i in LF:
    if i in fmL: continue
    o = L[i]
    j = pmatch.get(i)
    why = 'no simulated order' if j is None else ('simulated order did not fill' if not filled(S[j]) else 'filled differently')
    marketable = bool(o.get('marketable'))
    live_only.append({'id': o['id'], 'ts': iso(o['ts']), 'book': o['book'], 'rung': f"{o['rung_side']} {o['k']}", 'leg': o['leg'], 'side': o['side'], 'price': f(o['price']),
                      'filled': f(o['filled_base']), 'of': f(o['base_size']), 'booked': iso(o['filled_at']), 'prints': 'marketable' if marketable else cls(o), 'why': why,
                      'sim_filled': f(S[j]['filled_base']) if j is not None else None})
sim_only = []
for j in SF:
    if j in fmS: continue
    o = S[j]
    i = next((i for i, jj in P if jj == j), None)
    sim_only.append({'ts': iso(o['ts']), 'book': o['book'], 'rung': f"{o['rung_side']} {o['k']}", 'leg': o['leg'], 'side': o['side'], 'price': f(o['price']),
                     'filled': f(o['filled_base']), 'booked': iso(o['filled_at']), 'why': 'no live order' if i is None else ('live order did not fill' if not filled(L[i]) else 'filled differently')})
R['fills'] = {'live': len(LF), 'sim': len(SF), 'matched': len(fm), 'recall': round(len(fm) / len(LF), 4), 'precision': round(len(fm) / len(SF), 4),
              'live_only_by_class': dict(collections.Counter((x['leg'], x['prints'], x['why']) .__str__() for x in live_only)),
              'sim_only_by_why': dict(collections.Counter((x['leg'], x['why']).__str__() for x in sim_only)),
              'live_partial': sum(1 for i in LF if f(L[i]['filled_base']) < f(L[i]['base_size']) - 1e-9),
              'sim_partial': sum(1 for j in SF if f(S[j]['filled_base']) < f(S[j]['base_size']) - 1e-9)}
# The fill rule on the same orders: of the order pairs both sides placed, how often they agree on filling at all.
agree = collections.Counter(('both' if filled(L[i]) and filled(S[j]) else 'live only' if filled(L[i]) else 'sim only' if filled(S[j]) else 'neither') for i, j in P)
R['matched_orders_fill_agreement'] = {**dict(agree), 'agree_share': round((agree['both'] + agree['neither']) / max(1, len(P)), 4),
                                      'filled_pairs_agree_share': round(agree['both'] / max(1, agree['both'] + agree['live only'] + agree['sim only']), 4)}
R['live_only_fills'] = live_only
R['sim_only_fills'] = sim_only
# Fees and pennies on the matched fills.
R['matched_fill_money'] = {'fee_live': round(sum(f(L[i]['fee_gbp']) for i, _ in fm), 4), 'fee_sim': round(sum(f(S[j]['fee_gbp']) for _, j in fm), 4),
                           'avg_price_diff_max': max((abs(f(L[i]['avg_fill_price']) - f(S[j]['avg_fill_price'])) for i, j in fm), default=0)}
# By day: fills and orders.
day = lambda t: datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime('%m-%d')
R['by_day'] = {d: {'live_orders': sum(1 for o in L if day(o['ts']) == d), 'sim_orders': sum(1 for o in S if day(o['ts']) == d),
                   'live_fills': sum(1 for i in LF if day(L[i]['ts']) == d), 'sim_fills': sum(1 for j in SF if day(S[j]['ts']) == d),
                   'matched_fills': sum(1 for i, _ in fm if day(L[i]['ts']) == d)} for d in sorted({day(o['ts']) for o in L + S})}
os.makedirs(os.path.join(here, 'results'), exist_ok=True)
json.dump(R, open(os.path.join(here, 'results', f'compare_{name}.json'), 'w'), indent=1, sort_keys=True)
print(json.dumps({k: R[k] for k in ('orders', 'entry_decisions', 'matched_orders_fill_agreement', 'matched_fill_money', 'sim_realised_gbp')}))
print(json.dumps({k: R['fills'][k] for k in ('live', 'sim', 'matched', 'recall', 'precision', 'live_partial', 'sim_partial')}))
