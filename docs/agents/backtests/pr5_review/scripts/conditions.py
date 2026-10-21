# PR5's paper test, 2026-09-23 15:09 -> 2026-10-21 15:09 UTC: the six conditions of
# docs/agents/reviews/2026-09-23-pr5-paper-test-spec.md ("What decides, after four weeks"), each read as the spec words it.
# Writes results/conditions.json.   python3 -I scripts/conditions.py
import sys, os, json, bisect, random, collections, datetime, statistics as st
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

R = {'window': [C.iso(C.T0), C.iso(C.T1)], 'days': C.DAYS, 'frozen_pr5_sim_sha256': C.frozen_sha()}
trips = C.load_trips()
rec = C.window_trips(trips)
closed = [t for t in rec if t['t_exit'] < C.T1]
events = [e for e in C.load_events() if C.T0 <= e['minute'] < C.T1]
fills = [e for e in events if e['kind'] == 'fill']
R['record'] = {'round_trips': C.summ(rec), 'closed_before_end': C.summ(closed), 'entry_fills': len(fills),
               'maker_exits': sum(1 for e in events if e['kind'] == 'exit'), 'stops': sum(1 for e in events if e['kind'] == 'stop')}

# ---- 1. Faithful: the FROZEN pr5_sim.py (unpatched source) on the stored prints, hourly candles and minute FX.
P = C.sim()
fx = P.fx_series()
books = {b: P.Book(b, C.T0, C.T1, fx) for b in C.BOOKS}
sim = []
for b in C.BOOKS: sim += P.simulate(books[b])[0]
end_min = C.T1 - C.M
forced = [t for t in sim if t['how'] == 'taker' and t['t_exit'] == end_min]           # the simulator closes what is open at its last minute
sim_closed = [t for t in sim if t not in forced]
c1 = {'sim': C.summ(sim), 'sim_closed': C.summ(sim_closed), 'sim_open_at_end': len(forced),
      'fills_sim': len(sim), 'fills_record': len(fills)}
c1['fills_diff_pct'] = round(100 * (len(sim) - len(fills)) / len(fills), 2)
c1['pnl_diff_pct'] = round(100 * (c1['sim_closed']['pnl_usd'] - R['record']['closed_before_end']['pnl_usd']) / R['record']['closed_before_end']['pnl_usd'], 2)
c1['pass'] = abs(c1['fills_diff_pct']) <= 5 and abs(c1['pnl_diff_pct']) <= 10
# Trip by trip: matched on (book, side, k, t_entry).
key = lambda t: (t['book'], t['side'], round(t['k'], 4), t['t_entry'])
a, b_ = {key(t): t for t in rec}, {key(t): t for t in sim}
c1['trips_matched'] = len(set(a) & set(b_))
c1['record_only'] = sorted([f'{k[0]} {k[1]} {k[2]} {C.iso(k[3])}' for k in set(a) - set(b_)])
c1['sim_only'] = sorted([f'{k[0]} {k[1]} {k[2]} {C.iso(k[3])}' for k in set(b_) - set(a)])
R['1_faithful'] = c1

# ---- 2. P&L after costs > 0 and above the random-time null's p95 (PR5's null: 2,000 draws, seed 20260923), on the same
# four weeks: each of the record's round trips replaced by a twin entered at the last print of a random traded minute of its
# book (with an X), exited by the rule's exit machinery (`exit_only` of the frozen file), as `main()` builds PR5's null.
pnl = R['record']['closed_before_end']['pnl_usd']
Ps = sorted(closed, key=lambda z: (z['book'], z['t_entry'], z['side'], z['k']))
pools = {b: [i for i in sorted(books[b].by_min) if books[b].X[i]] for b in C.BOOKS}
rng = random.Random(20260923)
cache, draws = {}, []
for d in range(2000):
    tot = 0.0
    for x in Ps:
        bk = x['book']
        i = pools[bk][rng.randrange(len(pools[bk]))]
        k = (bk, i, x['side'])
        if k not in cache:
            Bk = books[bk]
            usd = min(100.0, 0.10 * Bk.qvol[i] * Bk.X[i])
            cache[k] = P.exit_only(Bk, i, x['side'], usd, Bk.X[i]) if usd > 0 else 0.0
        tot += cache[k]
    draws.append(tot)
draws.sort()
p95 = draws[int(0.95 * (len(draws) - 1))]
R['2_pnl_vs_null'] = {'pnl_usd': pnl, 'null': {'draws': 2000, 'seed': 20260923, 'mean': round(st.mean(draws), 4), 'p50': round(draws[1000], 4),
                      'p95': round(p95, 4), 'max': round(draws[-1], 4), 'share_ge_record': round(sum(1 for v in draws if v >= pnl) / 2000, 4),
                      'twins_simulated': len(cache)}, 'pass': pnl > 0 and pnl > p95}

# ---- 3. Worth more than cash: at least 8 %/yr on the $1,200 the quotes lock = $0.26 a day.
per_day = pnl / C.DAYS
R['3_worth_more_than_cash'] = {'pnl_usd_per_day': round(per_day, 4), 'pct_per_year_on_1200': round(100 * per_day * 365 / 1200, 2),
                               'bar_usd_per_day': 0.26, 'pass': per_day >= 0.26}

# ---- 4. Fills the book would have allowed: >= 90 % of paper fills with a go-live snapshot in which the post-only order
# is accepted (a bid under the best ask, an ask over the best bid). Every fill: the entry fills and the maker exits.
snap = {}
for l in C.lines('books'):
    bk, t, d = l.split('|', 2)
    d = json.loads(d); lv = d.get('book') or {}
    if isinstance(lv, dict) and 'data' in lv: lv = lv['data']
    px = lambda side: [float(r['price'] if isinstance(r, dict) else r[0]) for r in (lv.get(side) or [])]
    snap[(bk, int(t))] = (max(px('bids'), default=None), min(px('asks'), default=None))
orders = collections.defaultdict(list)
for e in C.load_events():
    if e['kind'] == 'order': orders[(e['book'], e['d'].get('oid'))].append(e)
rows = []
for e in events:
    if e['kind'] not in ('fill', 'exit'): continue
    oid = e['d'].get('oid')
    prior = [o for o in orders[(e['book'], oid)] if o['minute'] < e['minute']]
    if not prior:
        rows.append({'kind': e['kind'], 'snapshot': None}); continue
    o = prior[-1]
    live = o['minute'] + C.M
    side = e['side'] if e['kind'] == 'fill' else ('ask' if e['side'] == 'bid' else 'bid')     # the ORDER's side
    s = snap.get((e['book'], live))
    p = e['ticks'] * C.TICK
    if not s:
        rows.append({'kind': e['kind'], 'snapshot': None, 'book': e['book'], 'live': C.iso(live)}); continue
    bb, ba = s
    acc = (ba is None or p < ba - 1e-9) if side == 'bid' else (bb is None or p > bb + 1e-9)
    best = (bb is None or p >= bb - 1e-9) if side == 'bid' else (ba is None or p <= ba + 1e-9)
    better = (bb is None or p > bb + 1e-9) if side == 'bid' else (ba is None or p < ba - 1e-9)
    rows.append({'kind': e['kind'], 'snapshot': True, 'accepted': acc, 'at_or_better_than_best': best, 'strictly_best': better})
with_snap = [r for r in rows if r['snapshot']]
def share(rs, f): return round(sum(1 for r in rs if r.get(f)) / len(rs), 4) if rs else None
c4 = {'fills': len(rows), 'with_snapshot': len(with_snap), 'no_snapshot': len(rows) - len(with_snap),
      'accepted': sum(1 for r in with_snap if r['accepted']), 'accepted_share_of_fills': round(sum(1 for r in with_snap if r['accepted']) / len(rows), 4),
      'accepted_share_of_snapshots': share(with_snap, 'accepted'),
      'at_or_better_than_best_share': share(with_snap, 'at_or_better_than_best'), 'strictly_best_share': share(with_snap, 'strictly_best')}
for kind in ('fill', 'exit'):
    rs = [r for r in with_snap if r['kind'] == kind]
    c4[kind] = {'n': sum(1 for r in rows if r['kind'] == kind), 'with_snapshot': len(rs), 'accepted_share': share(rs, 'accepted'),
                'at_or_better_than_best_share': share(rs, 'at_or_better_than_best')}
c4['pass'] = c4['accepted_share_of_fills'] >= 0.90
R['4_fills_the_book_allowed'] = c4

# ---- 5. Order budget: at most 700 orders on EVERY day (placements, re-prices and re-placements: the `order` events).
byday = collections.Counter(datetime.datetime.fromtimestamp(e['minute'] / 1000, datetime.timezone.utc).strftime('%Y-%m-%d') for e in events if e['kind'] == 'order')
days_table = {l.split('|')[0]: int(l.split('|')[1]) for l in C.lines('days')}
R['5_order_budget'] = {'by_day': dict(sorted(byday.items())), 'max': max(byday.values()), 'max_day': max(byday, key=byday.get),
                       'days_over_700': sorted(d for d, n in byday.items() if n > 700),
                       'engine_days_table_agrees': all(days_table.get(d) == n for d, n in byday.items() if d not in (C.iso(C.T0)[:10], C.iso(C.T1)[:10])),
                       'pass': max(byday.values()) <= 700}

# ---- 6. The regime, weekly: the median gap between adjacent BUY and SELL prints within 60 s (PR5's diagnostics.py).
prints = C.load_prints()
week = lambda t: datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime('%G-W%V')
gap = collections.defaultdict(list); gapb = collections.defaultdict(list)
for b in C.BOOKS:
    pr = prints[b]
    for a_, c_ in zip(pr, pr[1:]):
        if a_[3] != c_[3] and c_[0] - a_[0] <= 60000 and C.T0 <= c_[0] < C.T1:
            buy = a_ if a_[3] == 'buy' else c_; sell = c_ if a_[3] == 'buy' else a_
            g = (buy[1] - sell[1]) / ((buy[1] + sell[1]) / 2) * 1e4
            gap[week(c_[0])].append(g); gapb[(b, week(c_[0]))].append(g)
wk_pnl = collections.defaultdict(float)
for t in closed: wk_pnl[week(t['t_entry'])] += t['pnl_usd']
R['6_regime_weekly'] = {w: {'buy_minus_sell_bps_p50': round(st.median(v), 2), 'pairs': len(v), 'pnl_usd': round(wk_pnl[w], 4),
                            'by_book': {b: (round(st.median(gapb[(b, w)]), 2) if gapb[(b, w)] else None) for b in C.BOOKS}} for w, v in sorted(gap.items())}
R['6_regime_weekly_recorded'] = True

R['verdict'] = {'1': c1['pass'], '2': R['2_pnl_vs_null']['pass'], '3': R['3_worth_more_than_cash']['pass'], '4': c4['pass'],
                '5': R['5_order_budget']['pass'], '6': 'recorded'}
R['verdict']['all_hold'] = all(v is True for k, v in R['verdict'].items() if k != '6')
C.dump('conditions.json', R)
print(json.dumps({k: R[k] for k in ('record', 'verdict')}, indent=1))
print('1', {k: c1[k] for k in ('fills_sim', 'fills_record', 'fills_diff_pct', 'pnl_diff_pct', 'sim_open_at_end', 'trips_matched')}, len(c1['record_only']), len(c1['sim_only']))
print('2', R['2_pnl_vs_null'])
print('3', R['3_worth_more_than_cash'])
print('4', {k: v for k, v in c4.items()})
print('5', {k: R['5_order_budget'][k] for k in ('max', 'max_day', 'days_over_700', 'engine_days_table_agrees')})
print('6', {w: (v['buy_minus_sell_bps_p50'], v['pairs']) for w, v in R['6_regime_weekly'].items()})
