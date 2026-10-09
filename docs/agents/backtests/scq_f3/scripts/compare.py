# The baseline's check: the replay with the exit at fair (results/runs/<run>.json.gz) against the twin's own record in
# production (data/raw/orders_<twin>.txt.gz, every order it wrote before 2026-10-09 16:00 UTC), order for order in the order
# written, then fill for fill (each entry, exit and stop fill: its rung, leg, the print instant that filled it, size and
# price). A turn's instant is compared to the minute: production turns at PR5's own read of the prints (about :25.005),
# the replay at :25.000. Prints the first differences and writes results/baseline_check_<twin>.json.
# python3 -I scripts/compare.py <run name> <twin: pr5|p50>
import gzip, json, os, sys, datetime
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
run, twin = sys.argv[1], sys.argv[2]
R = json.load(gzip.open(os.path.join(here, 'results', 'runs', f'{run}.json.gz')))
UNTIL = 1791561600000
iso = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime('%m-%d %H:%M:%S.%f')[:-3] if ms else None
prod = []
for l in gzip.open(os.path.join(here, 'data', 'raw', f'orders_{twin}.txt.gz'), 'rt'):
    if not l.strip(): continue
    o = json.loads(l)
    if o[2] != 'live': continue
    # → [id, ts, book, rung_side, k, leg, side, state, price, base_size, filled_base, avg, fee, filled_at, not_sent]
    prod.append([o[0], o[1], o[3], o[4], None if o[5] is None else float(o[5]), o[6], o[7], o[8], float(o[12]), float(o[9] or 0), float(o[10] or 0),
                 None if o[11] is None else float(o[11]), float(o[13] or 0), o[14], bool(o[15])])
prod.sort(key=lambda o: o[0])
rep = sorted(R['orders'], key=lambda o: o[0])
M = 60000
# Orders still open in production at the cut may have filled after it; the replay stops at the cut too.
def key(o, with_state=True):
    k = (o[1] // M, o[2], o[3], None if o[4] is None else float(o[4]), o[5], o[6], round(float(o[8]), 4), round(float(o[9]), 5))
    return tuple(str(x) for x in k + ((o[7] if o[7] not in ('new', 'partially_filled', 'pending') else 'open', round(float(o[10]), 5), None if o[13] is None else o[13] // 1000) if with_state else ()))
diffs = []
i = 0
n = min(len(prod), len(rep))
first_order_diff = None
for i in range(n):
    if key(prod[i]) != key(rep[i]):
        first_order_diff = i; break
from collections import Counter
cp, cr = Counter(key(o) for o in prod), Counter(key(o) for o in rep)
order_only_p, order_only_r = sorted((cp - cr).elements()), sorted((cr - cp).elements())
fills = lambda os_: sorted((o[13] // 1000 * 1000, str(o[2]), str(o[3]), str(o[4]), o[5], round(o[10], 5), round(o[11] or 0, 4)) for o in os_ if o[10] > 0 and o[13] is not None and o[13] < UNTIL)
pf, rf = fills(prod), fills(rep)
ps, rs = set(pf), set(rf)
only_p = sorted(ps - rs); only_r = sorted(rs - ps)
out = {
    'run': run, 'twin': twin, 'orders': {'production': len(prod), 'replay': len(rep)},
    'first_order_difference': None if first_order_diff is None else {'index': first_order_diff, 'production': prod[first_order_diff], 'replay': rep[first_order_diff],
        'production_iso': iso(prod[first_order_diff][1]), 'replay_iso': iso(rep[first_order_diff][1])},
    'orders_production_only': [list(x) for x in order_only_p], 'orders_replay_only': [list(x) for x in order_only_r],
    'fills': {'production': len(pf), 'replay': len(rf), 'both': len(ps & rs), 'production_only': [[iso(f[0])] + list(f[1:]) for f in only_p], 'replay_only': [[iso(f[0])] + list(f[1:]) for f in only_r]},
}
json.dump(out, open(os.path.join(here, 'results', f'baseline_check_{twin}.json'), 'w'), indent=1)
print('orders', out['orders'], 'production only', len(order_only_p), 'replay only', len(order_only_r))
print('fills', out['fills']['production'], out['fills']['replay'], 'both', out['fills']['both'])
for f in out['fills']['production_only'][:15]: print('  prod only', f)
for f in out['fills']['replay_only'][:15]: print('  replay only', f)
