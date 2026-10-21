# Which fill rule LIVE's resting orders follow, measured on LIVE's own record (data/live_orders.txt, every maker order
# sent from 2026-10-01 16:29:53 to 2026-10-21 15:09 UTC) against the public prints (../pr5_review/data/prints.txt.gz)
# and PR5's go-live order-book snapshots (../pr5_review/data/books.txt.gz). For each order, from its placement to its end
# (its booked fill, or its cancel), three rules predict how much of it fills:
#   through  the simulator's: prints strictly through its price, by their own quantity
#   at       also every print AT its price from the other side, by its quantity (no queue)
#   queue    also the prints at its price, but only after the quantity resting at that price in the go-live snapshot
#            before it (FIFO behind the visible queue; ahead of it nothing when its price improved the book)
# and each prediction is compared with what LIVE was filled. Writes results/fill_model.json.
#   python3 -I scripts/fill_model.py
import gzip, json, os, collections, bisect
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T0, T1 = 1790872193000, 1792595340000
M = 60000
live = [json.loads(l) for l in gzip.open(os.path.join(here, 'data', 'live_orders.txt.gz'), 'rt') if l.strip()]
orders = [o for o in live if T0 <= o['ts'] < T1 and not o['not_sent'] and not o.get('marketable') and o['leg'] in ('entry', 'exit', 'convert')
          and o['state'] in ('filled', 'cancelled', 'partially_filled')]
prints = collections.defaultdict(list)
for l in gzip.open(os.path.join(here, '..', 'pr5_review', 'data', 'prints.txt.gz'), 'rt'):
    if l.strip():
        i, b, t, p, q, s = l.strip().split('|'); prints[b].append((int(t), round(float(p) / 1e-4), float(q), s))
pts = {b: [p[0] for p in v] for b, v in prints.items()}
snaps = collections.defaultdict(dict)
for l in gzip.open(os.path.join(here, '..', 'pr5_review', 'data', 'books.txt.gz'), 'rt'):
    if not l.strip(): continue
    b, t, d = l.rstrip('\n').split('|', 2)
    d = json.loads(d); lv = d.get('book') or {}
    if 'data' in lv: lv = lv['data']
    lev = lambda side: {round(float(r['price']) / 1e-4): float(r['quantity']) for r in (lv.get(side) or [])}
    snaps[b][int(t)] = {'bids': lev('bids'), 'asks': lev('asks'), 'at': d.get('at')}
snap_t = {b: sorted(v) for b, v in snaps.items()}
f = lambda x: float(x or 0)


def queue_ahead(o):
    """The quantity resting at the order's price, before it, in the newest go-live snapshot at or before its placement."""
    b, px = o['book'], round(f(o['price']) / 1e-4)
    ts = snap_t.get(b, [])
    k = bisect.bisect_right(ts, o['ts']) - 1
    if k < 0 or o['ts'] - ts[k] > 2 * M: return None
    s = snaps[b][ts[k]]
    lv = s['bids'] if o['side'] == 'buy' else s['asks']
    return lv.get(px, 0.0)


rows = []
for o in orders:
    b, px, side = o['book'], round(f(o['price']) / 1e-4), o['side']
    end = o['filled_at'] or o['cancelled_at'] or o['ts']
    a, z = bisect.bisect_right(pts[b], o['ts']), bisect.bisect_right(pts[b], end)
    thr = at = 0.0
    for t, p, q, s in prints[b][a:z]:
        if (side == 'buy' and p < px) or (side == 'sell' and p > px): thr += q
        elif p == px and s == ('sell' if side == 'buy' else 'buy'): at += q
    size, got = f(o['base_size']), f(o['filled_base'])
    qa = queue_ahead(o)
    pred = {'through': min(size, thr), 'at': min(size, thr + at), 'queue': None if qa is None else min(size, thr + max(0.0, at - qa))}
    rows.append({'id': o['id'], 'leg': o['leg'], 'size': size, 'got': got, 'thr': thr, 'at': at, 'queue_ahead': qa, 'pred': pred})


def score(rule, sel=lambda r: True):
    rs = [r for r in rows if sel(r) and r['pred'][rule] is not None]
    filled = lambda x, r: x >= 0.99 * r['size'] if x else False
    tp = sum(1 for r in rs if r['got'] > 0 and r['pred'][rule] > 0)
    fn = sum(1 for r in rs if r['got'] > 0 and not r['pred'][rule] > 0)
    fp = sum(1 for r in rs if not r['got'] > 0 and r['pred'][rule] > 0)
    tn = sum(1 for r in rs if not r['got'] > 0 and not r['pred'][rule] > 0)
    qty_err = sum(abs(r['pred'][rule] - r['got']) for r in rs) / max(1e-9, sum(r['got'] for r in rs))
    return {'orders': len(rs), 'live_filled': tp + fn, 'predicted_and_filled': tp, 'missed': fn, 'false_fills': fp, 'agree_share': round((tp + tn) / len(rs), 4) if rs else None,
            'qty_abs_error_over_filled_qty': round(qty_err, 4), 'pred_qty': round(sum(r['pred'][rule] for r in rs), 2), 'live_qty': round(sum(r['got'] for r in rs), 2)}


R = {'orders': len(rows), 'with_snapshot': sum(1 for r in rows if r['queue_ahead'] is not None)}
for leg in ('all', 'entry', 'exit'):
    sel = (lambda r: True) if leg == 'all' else (lambda r, L=leg: r['leg'] == L)
    R[leg] = {rule: score(rule, sel) for rule in ('through', 'at', 'queue')}
    # The same three on the orders that have a snapshot, so the rules are compared on one set.
    R[leg + '_with_snapshot'] = {rule: score(rule, lambda r, s=sel: s(r) and r['queue_ahead'] is not None) for rule in ('through', 'at', 'queue')}
cls = collections.Counter()
for r in rows:
    if r['got'] > 0: cls[('through' if r['thr'] > 0 else ('at only' if r['at'] > 0 else 'neither'), r['leg'])] += 1
R['live_fills_by_prints'] = {f'{a} | {b}': n for (a, b), n in sorted(cls.items())}
json.dump(R, open(os.path.join(here, 'results', 'fill_model.json'), 'w'), indent=1, sort_keys=True)
print(json.dumps(R, indent=1))
