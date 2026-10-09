# 2026-10-09 stablecoin quotes review: would an exit resting m ticks beyond fair (m = 1, 2, 3; a tick is 0.0001, about
# 1.3 bps) still have filled, and how much later? An indicator for a TESTING variant, not a replay: for every round trip
# closed by its maker exit, from the filled exit order's own placement, the stored UK prints (data/prints.json) strictly
# through the shifted price are summed in time order, as revx_sim.ts fills a resting order (rule 1: by their quantity);
# the trip "still fills" when they reach the exit's size within 24 hours of the entry fill (the 24-hour stop). Not
# modelled: the exit's re-price when fair moves past 0.05 % (the shifted exit would move with it), and depth shared
# with other orders. Writes results/exit_offset.json.
# python3 -I scripts/exit_offset.py   (from this folder)
import json, bisect, os
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda p: json.load(open(os.path.join(here, p)))
pnl = J('results/page_pnl.json')
prints = {}
for book, ms, price, qty, side in J('data/prints.json')['rows']:
    prints.setdefault(book, []).append((ms, float(price), float(qty)))
for b in prints: prints[b].sort()
TABLE = {'live': 'agent_quote_live_orders', 'pr5': 'agent_quote_twin_pr5_orders', 'p50': 'agent_quote_twin_p50_orders', 'd': 'agent_quote_twin_d_orders'}
from datetime import datetime
ms = lambda s: int(datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)
out = {}
for inst, table in TABLE.items():
    rows = {r[0]: r for r in J(f'data/{table}.json')['rows']}
    res = {m: {'trips': 0, 'fill': 0, 'extra_gbp': 0.0, 'delay_min': []} for m in (1, 2, 3)}
    base_n = 0
    for t in pnl[inst]['trips']:
        if t['how'] != 'exit' or t['qty'] * t['entry'] < 1: continue
        exits = [rows[i] for i in t['ids'] if rows[i][6] == 'exit' and float(rows[i][10]) > 0]
        if not exits: continue
        x = exits[-1]
        side, price, qty = x[7], float(x[12]), float(x[10])
        placed, filled_at = ms(x[1]), ms(x[14] or x[1])
        entry_ms = ms(t['tEntry'])
        base_n += 1
        P = prints[t['book']]
        i0 = bisect.bisect_left(P, (placed, 0, 0))
        for m in (1, 2, 3):
            alt = round(price + (m if side == 'sell' else -m) * 0.0001, 4)
            got, when = 0.0, None
            for tms, p, q in P[i0:]:
                if tms > entry_ms + 86400e3: break
                if (side == 'sell' and p > alt + 1e-9) or (side == 'buy' and p < alt - 1e-9):
                    got += q
                    if got >= qty - 1e-9: when = tms; break
            r = res[m]; r['trips'] += 1
            if when is not None:
                r['fill'] += 1; r['extra_gbp'] += m * 0.0001 * qty; r['delay_min'].append((when - filled_at) / 60e3)
    for m in (1, 2, 3):
        d = sorted(res[m]['delay_min'])
        res[m]['median_delay_min'] = d[len(d) // 2] if d else None
        res[m]['p90_delay_min'] = d[int(len(d) * 0.9)] if d else None
        del res[m]['delay_min']
    out[inst] = {'trips': base_n, 'offsets': res}
    print(inst, base_n, {m: (res[m]['fill'], round(res[m]['extra_gbp'], 4), res[m]['median_delay_min'], res[m]['p90_delay_min']) for m in (1, 2, 3)})
json.dump(out, open(os.path.join(here, 'results/exit_offset.json'), 'w'), indent=1)
