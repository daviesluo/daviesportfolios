# LP-ADVERSE: markouts of every live fill, split every way the brief asks, with market-day bootstrap ranges.
#   LPADV_WORK=<scratch> python3 -I docs/agents/backtests/lpadverse/scripts/markouts.py > docs/agents/backtests/lpadverse/results/markouts.txt
# A fill's markout at horizon h is d x (mid(t + h) - y) x size: y its YES-equivalent price, d +1 when it added YES
# exposure (a BUY of YES or a SELL of NO), -1 otherwise; mid the YES touch's midpoint (live-prep's own minute, the book
# without our orders, where it watched the market; the pm-rec recorder's book elsewhere). Positive = the fill earned.
# "fill" is the mid just before the fill (the half-spread captured); "now" is the value at the end of the record: the
# payout of a resolved market, else the last mid (its sum is the whole fills P&L, pnl.py).
import sys, os, pickle
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

F = pickle.load(open(os.path.join(WORK, 'fills.pkl'), 'rb'))
P = pickle.load(open(os.path.join(WORK, 'pnl.pkl'), 'rb'))
rows = F['rows']
for r in rows:
    pv = P['per_now'][r['cond']]
    r['V_now'] = pv[2]
    r['mo_now'] = r['d'] * (pv[2] - r['y']) * r['size']
    r['mkday'] = (r['cond'], r['day'])

H = ['fill', '5m', '60m', '6h', 'now']
def line(lab, rs, boot=True):
    sh = sum(r['size'] for r in rs)
    cells = []
    for h in H:
        xs = [r for r in rs if r['mo_' + h] is not None]
        s = sum(r['mo_' + h] for r in xs); ssh = sum(r['size'] for r in xs)
        cells.append(f"{s:>8.2f} ({100 * s / ssh if ssh else 0:>6.2f})")
    ci = ''
    if boot:
        g = {}
        for r in rs:
            if r['mo_60m'] is not None: g.setdefault(r['mkday'], []).append(r)
        if len(g) >= 3:
            lo, md, hi = bootstrap(g, lambda d: 100 * sum(r['mo_60m'] for r in d) / max(1e-9, sum(r['size'] for r in d)), n=2000)
            ci = f"  [{lo:>6.2f}, {hi:>6.2f}] c/sh 60m, {len(g)} mkt-days"
    print(f"{lab:<28}{len(rs):>5}{sh:>8.0f} " + ' '.join(cells) + ci)

def table(title, key, order=None):
    print(f"\n== {title}")
    print(f"{'group':<28}{'fills':>5}{'shares':>8} " + ' '.join(f"{('mo_' + h + ' $ (c/sh)'):>17}" for h in H))
    g = {}
    for r in rows:
        k = key(r)
        if k is None: k = '(unknown)'
        g.setdefault(k, []).append(r)
    ks = sorted(g, key=lambda k: sum(r['mo_now'] for r in g[k])) if order == 'now' else (order or sorted(g, key=lambda k: str(k)))
    for k in ks:
        if k in g: line(str(k), g[k])
    line('all', rows, boot=False)

def bucket(x, edges, fmt='{:g}'):
    if x is None: return None
    for i, e in enumerate(edges):
        if x < e: return f"{i:02d} <{fmt.format(e)}"
    return f"{len(edges):02d} >={fmt.format(edges[-1])}"

print("LP-ADVERSE markouts. Every live fill of live-prep (pm_lp_fills, CONFIRMED, 2026-10-09 01:42 -> 2026-10-12 22:48 UTC).")
print("Cells: markout $ (cents a share). Positive = the fill earned. Range: 5th-95th percentile of the 60-minute markout in")
print("cents a share, bootstrap over market-days (2,000 draws, seed 20261012).")
table('all fills by side (BUY = an entry, SELL = an exit of what was held)', lambda r: r['side'])
table('by side and outcome', lambda r: f"{r['side']} {r['outcome']}")
table('by market type (this study\'s finer type)', lambda r: r['type'])
table("by market type (pm_lp.ts's lpMarketType)", lambda r: r['lp_type'])
table('BUYs only, by type', lambda r: r['type'] if r['side'] == 'BUY' else 'zz SELL (exits)')
table('by days to the scheduled end', lambda r: bucket(r['days_to_end'], [1, 2, 4, 7, 14, 30]))
table('by YES-equivalent price of the fill', lambda r: bucket(r['y'], [0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9]))
table('by the token bought or sold: its own price (longshot vs favourite)', lambda r: bucket(r['price'], [0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9]))
table('by distance of the fill from the mid before it, cents (>0 = on our side of the mid)', lambda r: bucket(r['dist_c'], [0, 0.5, 1, 1.5, 2.5, 5]))
table('by width of the touch before the fill, cents', lambda r: bucket(r['width_c'], [1.01, 2.01, 3.01, 5.01, 10.01]))
table('by tick size', lambda r: r['tick'])
table('by shares within 3 c of the best on the side we were hit', lambda r: bucket(r['depth3_our'], [100, 500, 2000, 10000]))
table('by the mid\'s minute-to-minute std over the hour before, cents', lambda r: bucket(r['vol_sd_c'], [0.1, 0.3, 0.6, 1.0, 2.0]))
table('by the mid\'s range over the hour before, cents', lambda r: bucket(r['vol_rng_c'], [0.5, 1.5, 3, 6]))
table('by the mid\'s range over the 24 hours before, cents', lambda r: bucket(r['vol_rng24_c'], [3, 6, 10, 20, 40]))
table('by taker prints in the market in the hour before', lambda r: bucket(r['prints_1h'], [1, 3, 10, 30]))
table('by taker prints in the 24 hours before', lambda r: bucket(r['prints_24h'], [10, 50, 150, 400]))
table('by the programme\'s daily rate, $', lambda r: bucket(r['rate'], [20, 50, 100, 200]))
table('by the reward minimum (N)', lambda r: r['min_size'])
table('by time our order had rested before the fill', lambda r: bucket(r['rest_s'], [60, 180, 600, 1800, 3600], '{:g}s'))
table('by hour of day (UTC)', lambda r: bucket(r['hour'], [4, 8, 12, 16, 20], '{:g}h'))
table('by the taker\'s size against ours (taker shares / our fill)', lambda r: bucket(r['taker_size'] / r['size'] if r['size'] else None, [1.01, 2, 5, 20]))
table('by how far the taker\'s own trade went past our price, cents (YES-equivalent)', lambda r: bucket(r['sweep_c'], [0.01, 1.01, 2.01, 5.01]))
table('by the market\'s state that minute', lambda r: r['state'])
table('by selection: rank on the day (None = carried)', lambda r: 'refill' if r['refill'] else ('carried' if r['rank'] is None else f"rank {r['rank']:02d}"))
table('by UTC day', lambda r: r['day'])
table('by market, worst first at "now"', lambda r: r['cond'][:10] + ' ' + r['type'][:16], order='now')
pickle.dump(rows, open(os.path.join(WORK, 'fills2.pkl'), 'wb'))
