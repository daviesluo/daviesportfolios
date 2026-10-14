# 2026-10-14 stablecoin quotes review: the £0.10 prints. Since 2026-10-08 one counterparty trades exactly £0.10 at the
# touch, alternately buying and selling, about 450 times a day (sql/aggregates.sql D2). This counts, for LIVE and each
# twin, the trips such a print makes (notional under £1), what they made, what they would have made at their orders'
# own prices with no penny rounding (what the venue did on LIVE: its fills are sized to £0.10 at our price), and the
# minutes a rung spent holding one (the rung quotes no entry while it holds).
# python3 -I scripts/dust.py   (from this folder; reads results/page_pnl.json and data/*.json)
import json, os
from datetime import datetime

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = json.load(open(os.path.join(HERE, 'results', 'page_pnl.json')))
TABLE = {'live': 'agent_quote_live_orders', 'pr5': 'agent_quote_twin_pr5_orders', 'p50': 'agent_quote_twin_p50_orders',
         'take50': 'agent_quote_twin_take50_orders', 'd': 'agent_quote_twin_d_orders'}
def ts(s): return datetime.fromisoformat(s.replace('Z', '+00:00'))
out = {}
for i, tab in TABLE.items():
    rows = json.load(open(os.path.join(HERE, 'data', tab + '.json')))['rows']
    price = {r[0]: float(r[12]) for r in rows}
    side = {r[0]: r[7] for r in rows}
    dust = [t for t in R[i]['trips'] if t['qty'] * t['entry'] < 1]
    by_day = {}
    at_price = 0.0
    for t in dust:
        # the first id is the entry, the last the exit (liveRungTrips keeps them in order)
        e, x = t['ids'][0], t['ids'][-1]
        pe, px = price.get(e), price.get(x)
        if pe and px:
            g = (px - pe) * t['qty'] if t['side'] == 'bid' else (pe - px) * t['qty']
            at_price += g
        d = t['tExit'][:10]
        c = by_day.setdefault(d, {'trips': 0, 'pnlGbp': 0.0, 'heldMinutes': 0.0})
        c['trips'] += 1; c['pnlGbp'] += t['pnlGbp']; c['heldMinutes'] += (ts(t['tExit']) - ts(t['tEntry'])).total_seconds() / 60
    out[i] = {'dustTrips': len(dust), 'pnlGbp': round(sum(t['pnlGbp'] for t in dust), 4),
              'atOrderPricesGbp': round(at_price, 4), 'pennyCostGbp': round(at_price - sum(t['pnlGbp'] for t in dust), 4),
              'heldRungMinutes': round(sum(v['heldMinutes'] for v in by_day.values()), 0),
              'byExitDay': {d: {k: round(v, 4) for k, v in c.items()} for d, c in sorted(by_day.items())}}
    print(i, {k: v for k, v in out[i].items() if k != 'byExitDay'})
json.dump(out, open(os.path.join(HERE, 'results', 'dust.json'), 'w'), indent=1)
