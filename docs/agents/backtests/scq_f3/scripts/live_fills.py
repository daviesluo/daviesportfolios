# Which fill assumption LIVE's own exits follow: for each maker exit of the real account that filled (its orders as the
# review read them, ../scq_review/data/agent_quote_live_orders.json, to 2026-10-09 15:57 UTC), the public UK prints
# (data/tape.txt.gz) from its placement to the turn that booked its fill: was any print strictly THROUGH its price (the
# twins' rule fills it), or only prints AT it from the other side (only the "at" assumption fills it), or neither? And
# the same for its entries. Writes results/live_fills.json.
# python3 -I scripts/live_fills.py
import gzip, json, os, datetime, collections
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ms = lambda s: int(datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)
tape = collections.defaultdict(list)
for l in gzip.open(os.path.join(here, 'data', 'tape.txt.gz'), 'rt'):
    if not l.strip(): continue
    i, b, t, p, q, s = l.strip().split('|'); tape[b].append((int(t), round(float(p) / 1e-4), float(q), s))
rows = json.load(open(os.path.join(here, '..', 'scq_review', 'data', 'agent_quote_live_orders.json')))['rows']
# [id, ts, mode, book, rung_side, k, leg, side, state, base_size, filled_base, avg_fill_price, price, fee_gbp, filled_at, ...]
out = {}
for leg in ('exit', 'entry'):
    c = collections.Counter(); qty = collections.Counter(); ex = []
    for r in rows:
        if r[6] != leg or not (float(r[10] or 0) > 0) or r[15] is True or (isinstance(r[19], dict) or r[19] is True): continue
        side, px, t0, t1 = r[7], round(float(r[12]) / 1e-4), ms(r[1]), ms(r[14] or r[1])
        ps = [p for p in tape[r[3]] if t0 < p[0] <= t1]
        thr = [p for p in ps if (p[1] > px if side == 'sell' else p[1] < px)]
        at = [p for p in ps if p[1] == px and p[3] == ('buy' if side == 'sell' else 'sell')]
        k = 'through' if thr else ('at only' if at else 'neither')
        c[k] += 1; qty[k] += float(r[10])
        ex.append({'id': r[0], 'book': r[3], 'side': side, 'price': px * 1e-4, 'placed': r[1], 'booked': r[14], 'class': k, 'printsThrough': len(thr), 'printsAt': len(at)})
    out[leg] = {'fills': sum(c.values()), 'by_class': dict(c), 'orders': ex}
json.dump(out, open(os.path.join(here, 'results', 'live_fills.json'), 'w'), indent=1)
print({k: (v['fills'], v['by_class']) for k, v in out.items()})
