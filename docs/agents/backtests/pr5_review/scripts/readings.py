# PR-5R's five readings of PR5's paper record (docs/agents/reviews/2026-09-28-pr5-readings-prereg.md), run as it specifies,
# on the four weeks 2026-09-23 15:09 -> 2026-10-21 15:09 UTC. None passes or fails the test. Writes results/readings.json.
#   python3 -I scripts/readings.py
import sys, os, json, collections, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C

R = {'window': [C.iso(C.T0), C.iso(C.T1)], 'frozen_pr5_sim_sha256': C.frozen_sha()}
rec_all = C.load_trips()
rec = C.window_trips(rec_all)
events_all = C.load_events()
events = [e for e in events_all if C.T0 <= e['minute'] < C.T1]
prints = C.load_prints()
key = lambda t: (t['book'], t['side'], round(t['k'], 4), t['t_entry'])
lab = lambda k: f'{k[0]} {k[1]} {k[2]} {C.iso(k[3])}'
end_min = C.T1 - C.M


def run(P, size=100.0, sides=('bid', 'ask')):
    books = C.rec_books(P)
    out = []
    for b in C.BOOKS: out += P.simulate(books[b], size=size)[0]
    return [t for t in out if t['side'] in sides], books


def compare(base, alt):
    """Trip by trip on (book, side, k, t_entry): matched P&L difference, and every unmatched trip either side."""
    A, B = {key(t): t for t in base}, {key(t): t for t in alt}
    both = set(A) & set(B)
    return {'matched': len(both), 'pnl_diff_on_matched_usd': round(sum(B[k]['pnl_usd'] - A[k]['pnl_usd'] for k in both), 4),
            'base_only': [{'trip': lab(k), 'pnl_usd': round(A[k]['pnl_usd'], 4)} for k in sorted(set(A) - set(B), key=lambda k: (k[3], k))],
            'alt_only': [{'trip': lab(k), 'pnl_usd': round(B[k]['pnl_usd'], 4)} for k in sorted(set(B) - set(A), key=lambda k: (k[3], k))]}


# ---------------------------------------------------------------- (d) the replay on the engine's own recorded inputs
Q = C.sim(C.EVENTS)
Q.EV = []
d_trips, d_books = run(Q)
ev_key = lambda e: (e['book'], e['minute'], e['side'], round(e['k'], 4), e['kind'], e['ticks'])
A = collections.Counter(ev_key(e) for e in events)
B = collections.Counter(ev_key(e) for e in Q.EV if C.T0 <= e['minute'] < C.T1)
only_rec, only_rep = sorted((A - B).elements(), key=lambda k: k[1]), sorted((B - A).elements(), key=lambda k: k[1])
R['d_replay'] = {
    'events_record': len(events), 'events_replay': sum(B.values()),
    'only_record': [dict(zip(('book', 'minute', 'side', 'k', 'kind', 'ticks'), (k[0], C.iso(k[1])) + k[2:])) for k in only_rec],
    'only_replay': [dict(zip(('book', 'minute', 'side', 'k', 'kind', 'ticks'), (k[0], C.iso(k[1])) + k[2:])) for k in only_rep],
    'first_difference': C.iso(min([k[1] for k in only_rec + only_rep])) if only_rec or only_rep else None,
    'note_only_replay': 'a stop at the last minute is the simulator closing what is open where its data ends (i == n-1); the engine still holds those positions',
    'minutes_without_record_after_2026-09-25_00:05': {b: len(d_books[b].unrecorded) for b in C.BOOKS},
    'minutes_whose_prints_differ_from_prints_n': {b: d_books[b].prints_mismatch[:20] for b in C.BOOKS},
    'minutes_approximate_before_record': {b: sum(1 for s in d_books[b].source if s == 'approx') for b in C.BOOKS},
    'trips_replay': C.summ(d_trips), 'trips_record': C.summ(rec),
    'trips_vs_record': compare(rec, d_trips),
}
open_end = [t for t in d_trips if t['how'] == 'taker' and t['t_exit'] == end_min]
d_closed = [t for t in d_trips if t not in open_end]

# ---------------------------------------------------------------- (a) strict fills, a re-simulation on (d)'s inputs
PS = C.sim(C.SIZEFN)                         # the baseline: the frozen rule, (d)'s inputs (the size hook does nothing for a number)
PA = C.sim(C.SIZEFN, C.STRICT)               # the same, with only the fill function replaced
base100, _ = run(PS)
a100, _ = run(PA)
R['a_strict'] = {'baseline': C.summ(base100), 'strict': C.summ(a100), 'pnl_change_usd': round(sum(t['pnl_usd'] for t in a100) - sum(t['pnl_usd'] for t in base100), 4),
                 'pnl_kept_share': round(sum(t['pnl_usd'] for t in a100) / sum(t['pnl_usd'] for t in base100), 4),
                 'exits_in_parts': sum(1 for t in a100 if '+parts' in str(t['how'])),
                 'entries_capped': sum(1 for t in a100 if t['notional_usd'] < 0.999 * next((u['notional_usd'] for u in base100 if key(u) == key(t)), t['notional_usd'])),
                 'trip_by_trip': compare(base100, a100),
                 'note': 'both runs close what is open at the last minute (2 positions in the baseline)'}

# ---------------------------------------------------------------- (b) the size ladder
fill_ev = {(e['book'], e['side'], round(e['k'], 4), e['minute']): e for e in events if e['kind'] == 'fill'}


def resized(trips, S_usd=None, S_gbp=None, sides=('bid', 'ask')):
    tot, n = 0.0, 0
    for t in trips:
        if t['side'] not in sides: continue
        e = fill_ev[(t['book'], t['side'], round(t['k'], 4), t['t_entry'])]['d']
        cap = 0.10 * e['minuteGbp'] * e['x']
        new = min(S_usd, cap) if S_usd is not None else min(S_gbp, 0.10 * e['minuteGbp']) * e['x']
        tot += t['pnl_usd'] * new / e['usd']; n += 1
    return {'trips': n, 'pnl_usd': round(tot, 4), 'pnl_usd_per_day': round(tot / C.DAYS, 4)}


R['b_size_ladder'] = {'frozen_fill_record_resized': {f'${S}': resized(rec, S_usd=S) for S in (25, 100, 300, 1000)}, 'under_a': {}}
for S in (25, 100, 300, 1000):
    base_s, _ = run(PS, size=float(S)); a_s, _ = run(PA, size=float(S))
    R['b_size_ladder']['under_a'][f'${S}'] = {'replay_d_at_size': C.summ(base_s), 'strict_a_at_size': C.summ(a_s)}

# ---------------------------------------------------------------- (c) the live path as configured on 2026-09-28: bids only, £50/12
G = 50 / 12
gbp = lambda x: G * x
base_c, _ = run(PS, size=gbp, sides=('bid',)); a_c, _ = run(PA, size=gbp, sides=('bid',))
R['c_live_path'] = {'rung_gbp': round(G, 4), 'frozen_fill_record_resized_bids': resized(rec, S_gbp=G, sides=('bid',)),
                    'under_a': {'replay_d_bids_at_size': C.summ(base_c), 'strict_a_bids_at_size': C.summ(a_c)},
                    'left_out': ['the -1 % daily loss stop', 'the de-peg and stale-input guards', 'the order governor', 'the bounded 24-hour IOC stop',
                                 'the ~30 s placement lag, priced by (e)']}

# ---------------------------------------------------------------- (e) the live executor's timing
orders = collections.defaultdict(list)
for e in events_all:
    if e['kind'] == 'order': orders[(e['book'], e['d'].get('oid'))].append(e)
for v in orders.values(): v.sort(key=lambda e: e['minute'])


def current_live(book, oid, before):
    prior = [o for o in orders[(book, oid)] if o['minute'] < before]
    return prior[-1]['minute'] + C.M if prior else None


def e1(sides):
    removed, kept_exits, n_exit = [], 0, 0
    for e in events:
        if e['side'] not in sides: continue
        if e['kind'] not in ('fill', 'exit'): continue
        L = current_live(e['book'], e['d'].get('oid'), e['minute'])
        early = L is not None and e['d']['print']['ts'] < L + 34_000
        if e['kind'] == 'fill' and early: removed.append(e)
        if e['kind'] == 'exit' and early: n_exit += 1
    gone = {(e['book'], e['side'], round(e['k'], 4), e['minute']) for e in removed}
    rest = [t for t in rec if t['side'] in sides and key(t) not in gone]
    lost = [t for t in rec if t['side'] in sides and key(t) in gone]
    return {'entry_fills_removed': len(removed), 'trips_removed_pnl_usd': round(sum(t['pnl_usd'] for t in lost), 4),
            'remaining': C.summ(rest), 'exit_fills_in_the_window_not_resimulated': n_exit,
            'removed': [f"{e['book']} {e['side']} {e['k']} {C.iso(e['minute'])} print +{(e['d']['print']['ts'] - current_live(e['book'], e['d'].get('oid'), e['minute'])) / 1000:.1f}s" for e in removed]}


minute_gbp = collections.defaultdict(float)
for b in C.BOOKS:
    for t, pt, q, sd, pid in prints[b]: minute_gbp[(b, t // C.M * C.M)] += q * pt * C.TICK
exit_trip = {(t['book'], t['exit_oid']): t for t in rec_all if t['exit_oid'] is not None}


def e2(sides):
    out = {'entry': {'reprices': 0, 'fills': 0, 'pnl_usd': 0.0}, 'exit': {'reprices': 0, 'fills': 0, 'pnl_usd': 0.0}}
    for e in events:
        if e['kind'] != 'order' or e['d'].get('what') != 'reprice' or e['side'] not in sides: continue
        leg = e['d'].get('leg')
        hist = orders[(e['book'], e['d'].get('oid'))]
        prev = [o for o in hist if o['minute'] < e['minute']]
        if not prev: continue
        old = prev[-1]['ticks']
        oside = e['side'] if leg == 'entry' else ('ask' if e['side'] == 'bid' else 'bid')
        out[leg]['reprices'] += 1
        t0 = e['minute']
        hit = None
        for t, pt, q, sd, pid in prints[e['book']]:
            if t < t0: continue
            if t >= t0 + 90_000: break
            if oside == 'bid' and pt < old and sd == 'sell': hit = (t, pt, q); break
            if oside == 'ask' and pt > old and sd == 'buy': hit = (t, pt, q); break
        if not hit: continue
        x, nf = e['d']['x'], e['d']['fair']
        p = old * C.TICK
        if leg == 'entry':
            usd = min(100.0, 0.10 * minute_gbp[(e['book'], hit[0] // C.M * C.M)] * x)
            qty = usd / x / p
        else:
            tr = exit_trip.get((e['book'], e['d'].get('oid')))
            qty = tr['qty'] if tr else 0.0
        pnl = qty * ((nf - p) if oside == 'bid' else (p - nf)) * x
        out[leg]['fills'] += 1; out[leg]['pnl_usd'] += pnl
    for v in out.values(): v['pnl_usd'] = round(v['pnl_usd'], 4)
    return out


R['e_timing'] = {'all_rungs': {'e1': e1(('bid', 'ask')), 'e2': e2(('bid', 'ask'))}, 'bid_rungs': {'e1': e1(('bid',)), 'e2': e2(('bid',))}}

C.dump('readings.json', R)
dd = R['d_replay']
print('d', dd['events_record'], dd['events_replay'], len(dd['only_record']), len(dd['only_replay']), dd['first_difference'], dd['minutes_approximate_before_record'], dd['trips_replay'], len(dd['trips_vs_record']['base_only']), len(dd['trips_vs_record']['alt_only']))
print('a', {k: R['a_strict'][k] for k in ('baseline', 'strict', 'pnl_change_usd', 'pnl_kept_share', 'exits_in_parts', 'entries_capped')}, R['a_strict']['trip_by_trip']['matched'], len(R['a_strict']['trip_by_trip']['base_only']), len(R['a_strict']['trip_by_trip']['alt_only']))
print('b', json.dumps(R['b_size_ladder']))
print('c', json.dumps(R['c_live_path']))
print('e', json.dumps({s: {'e1': {k: v for k, v in R['e_timing'][s]['e1'].items() if k != 'removed'}, 'e2': R['e_timing'][s]['e2']} for s in R['e_timing']}))
