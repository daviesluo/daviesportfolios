# Q2-PM (2026-10-14): Q2's first live day (live-prep's Addendum 19, live since 2026-10-13 13:25:32 UTC) against LP-BEST's
# engine, line by line, and what would have done better. Read-only: the live record as saved replies (Q2PM_LIVE, a folder
# with live_aux.json, live_minutes.json.gz and live_orders.json.gz from sql/q2pm_live.sql), pm-rec's archive through the
# work folder q2pm_data.py builds (LPBEST_WORK, to 2026-10-14 01:59 UTC), keyless reads of the CLOB.
#   LPBEST_WORK=<Q2PM_WORK> LPBEST_API_TAPE=1 Q2PM_LIVE=<dir> python3 -I docs/agents/backtests/lpbest/scripts/q2pm.py <step>
# Steps (each writes <work>/q2pm_<step>.json beside what it prints; results/q2pm_<step>.txt is the print):
#   check  Q2 at $316 on 10-05 -> 10-12 in this folder: LP-BEST's +$3.61 a day, so the folder is LP-BEST's
#   live   the live record over the window: each pick's minutes by what rested and why not, the formula, the payout,
#          every fill in YES terms with its class (LP-SPEED's) and its markouts, each market's fills P&L at the end mark
#   run    the engine on the same window with the live picks: as designed (the 00:00 / 13:26 picks all day) and as run
#          (each pick from its selection to its replacement, the refills as live took them), and one assumption at a time
#   prog   how often the programmes move within a day (pm-rec's listing reads, every market, 10-04 -> 10-14; the live
#          reward check's minute reads), whether our quoting moves them, and the CLOB's start dates now
#   opt    the candidates through the engine, on the live window and on 10-05 -> 10-12, raw and calibrated to live day 1
import os, sys, json, gzip, re, math, bisect, collections, contextlib
from datetime import datetime, timezone
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, engine, strat, runs
from engine import P

LIVE = os.environ.get('Q2PM_LIVE', '')
OUT = lambda name: os.path.join(lib.WORK, f'q2pm_{name}.json')
EQ = 316.0
RESTART = '2026-10-13T13:25:32Z'

def mi(s):
    return int(pd.Timestamp(s).timestamp()) // 60

def iso(m):
    return datetime.fromtimestamp(m * 60, timezone.utc).strftime('%m-%d %H:%M')

T0 = mi('2026-10-13T13:26:00Z')          # the first live picks (13:26:01)
T1 = mi('2026-10-14T02:00:00Z') - 1      # the archive's last closed minute when this ran
D13, D14 = '2026-10-13', '2026-10-14'
for d in (D13, D14):
    strat.D0[d] = mi(d + 'T00:00:00Z')
ALLDAYS = strat.DAYS + [D13, D14]

def q2_policy(name='Q2', eq=EQ, **kw):
    """Q2 as live runs it: RW's price, N a side, 2N, a touch of 4 c for entries; TB1 replaced by the touch rule, so a
    one-tick book still rests the exit (Addendum 19 and 21: min_width_ticks 0), x2's pause 15 c / 60 min."""
    cap = runs.cap_of(eq)
    base = dict(name=name, cap_total=cap, cap_market=min(100.0, cap), min_width_c=4, min_width_ticks=0, place='inside', k=0, inv_cap=2)
    base.update(kw)
    return P(**base)

def q2_select(day_df, eq=EQ, k=12, min_width_c=4, score=None):
    x = strat.eligible(day_df, min_width_c=min_width_c, max_api_vol=50)
    s = x.est0 / x.cap0 if score is None else score(x)
    return strat.choose(x, s, 0.9 * runs.cap_of(eq), k)

def boot(vals, n=2000, seed=20261014):
    vals = np.asarray(vals, float)
    if not len(vals): return 0.0, 0.0
    r = np.random.default_rng(seed)
    t = vals[r.integers(0, len(vals), size=(n, len(vals)))].sum(1)
    return tuple(np.percentile(t, [5, 95]))

def by_cond():
    return {m['cond']: i for i, m in lib.meta().items()}

# --------------------------------------------------------------------------------------------- the engine, extended
# Three switches engine.py does not have, made by exact substitutions of its own source (each must match once), so the
# frozen engine stays the one validated against live and every candidate below differs from it only where named:
#   pause_exits  a paused market still rests its exits (x2's pause stops entries only)
#   pause_raw    x2's pause reads the raw touch midpoint's jump, not the size-adjusted one
#   drop_on_dip  is not here: the live handling of a programme dip (out, refilled, not taken again) is a schedule
_EX = None
def engine_x():
    global _EX
    if _EX is not None: return _EX
    src = open(engine.__file__).read()
    subs = [
        ("            if paused: rest_any = False\n",
         "            if paused: rest_any = bool(policy.get('pause_exits'))\n"),
        ("            if quoting and policy['jump_c'] and M.jump[i] >= policy['jump_c'] - 1e-9:\n",
         "            if quoting and policy['jump_c'] and (M.jump_raw if policy.get('pause_raw') else M.jump)[i] >= policy['jump_c'] - 1e-9:\n"),
        ("    M.jump = np.nan_to_num(jump)\n",
         "    M.jump = np.nan_to_num(jump)\n    jr = np.zeros(len(mid)); jr[1:] = np.abs(np.diff(mid)) * 100\n"
         "    jr[1:][(M.t[1:] - M.t[:-1]) > 5] = 0\n    M.jump_raw = np.nan_to_num(jr)\n"),
    ]
    for a, b in subs:
        assert src.count(a) == 1, a
        src = src.replace(a, b)
    import types
    mod = types.ModuleType('engine_x'); mod.__file__ = engine.__file__
    exec(compile(src, engine.__file__ + ' (q2pm substitutions)', 'exec'), mod.__dict__)
    _EX = mod
    return mod

@contextlib.contextmanager
def segments(bounds):
    """Run the engine with its 'day' cut at every minute of `bounds` (a schedule entry per segment, keyed 'day#k'): how a
    pick that leaves mid-day, or a refill that starts mid-day, is given to an engine that reads one list a UTC day."""
    old = lib.day_of_min
    starts = sorted(bounds)
    keys = {s: f"{lib.day_of_min(s)}#{s}" for s in starts}
    def day_of(t):
        j = bisect.bisect_right(starts, t) - 1
        return keys[starts[j]] if j >= 0 else old(t)
    lib.day_of_min = day_of
    try:
        yield keys
    finally:
        lib.day_of_min = old

def run_segments(policy, picks, t0, t1, ex=True):
    """picks: [(mid, rank, start minute, end minute)] - selected (entries allowed) in [start, end); carried after."""
    bounds = {t0} | {max(t0, s) for (_, _, s, e) in picks if s <= t1} | {e for (_, _, s, e) in picks if t0 < e <= t1}
    for d in pd.date_range(pd.Timestamp(t0 * 60, unit='s', tz='UTC').normalize(), pd.Timestamp(t1 * 60, unit='s', tz='UTC'), freq='D'):
        m = int(d.timestamp()) // 60
        if t0 < m <= t1: bounds.add(m)
    E = engine_x() if ex else engine
    with segments(bounds) as keys:
        sched = {}
        for s, k in keys.items():
            nxt = min([b for b in bounds if b > s], default=t1 + 1)
            sched[k] = sorted([(mid, rank, None) for (mid, rank, a, e) in picks if a <= s and e >= nxt], key=lambda x: x[1])
        res = E.run(policy, sched, t0, t1)
    # md keys back to UTC days
    md = collections.defaultdict(lambda: [0.0, 0.0, 0.0])
    for k, v in res['md'].items():
        mid, d = k.split('|'); d = d.split('#')[0]
        for j in range(3): md[(int(mid), d)][j] += v[j]
    res['md_day'] = md
    return res

def summary(res, ndays):
    vals = [sum(v) for v in res['md_day'].values()] if 'md_day' in res else [sum(v) for v in res['md'].values()]
    lo, hi = boot(vals)
    return dict(total=res['total'], per_day=res['total'] / ndays, lo=lo / ndays, hi=hi / ndays, paid=res['paid'], rebate=res['rebate'],
                fills=res['fills_pnl'], formula2=res['formula2'], shares=res['shares'], nfills=res['fills'], mo60=res['mo60'])

# ------------------------------------------------------------------------------------------------------------ check
def check():
    df = strat.daytable()
    pol = q2_policy(min_width_ticks=2)          # LP-BEST's Q2 as priced (TB1 left at its default)
    sch = {d: [(int(r.mid), i + 1, None) for i, r in enumerate(q2_select(df[df.day == d]))] for d in strat.DAYS}
    o, res = strat.price(pol, sch, strat.DAYS, label='Q2 $316 (LP-BEST, TB1 2 ticks)')
    print(strat.fmt(o))
    pol = q2_policy()
    o2, res2 = strat.price(pol, sch, strat.DAYS, label='Q2 $316, exits in a one-tick book (A21)')
    print(strat.fmt(o2))
    json.dump({'lpbest': o, 'a21': o2}, open(OUT('check'), 'w'), default=float)

# ------------------------------------------------------------------------------------------------------------- live
def load_live():
    aux = json.load(open(os.path.join(LIVE, 'live_aux.json')))
    rows = json.load(gzip.open(os.path.join(LIVE, 'live_minutes.json.gz'), 'rt'))['rows']
    return aux, rows

def live_picks(aux, rows):
    """Every pick since the restart: its UTC day, rank, the minute it was selected, the minute it was replaced by a refill
    (its slot handed over; the live minutes' `detail.reward.out` names the time), else its day's end."""
    rep = {}
    for x in rows:
        o = x[20]
        if o and 'replaced by a refill' in o:
            m = re.search(r' at (\S+Z)', o)
            if m: rep.setdefault(x[1], set()).add(mi(m.group(1)))
    out = []
    for m in aux['markets']:
        if not m['selected_at'] or m['selected_at'] < RESTART: continue
        s = mi(m['selected_at'])
        dend = mi(m['day'] + 'T00:00:00Z') + 1440
        e = min([r for r in rep.get(m['cond'], ()) if s <= r < dend], default=dend)
        out.append(dict(cond=m['cond'], day=m['day'], rank=m['rank'], start=s, end=e, rate=m['reward_rate'], v=m['max_spread'],
                        capital=m['capital'], q=(m.get('question') or '')[:70], refill=m['rank'] > 12))
    return sorted(out, key=lambda p: (p['start'], p['rank']))

def fills_yes(aux):
    tok = {}
    for m in aux['markets']:
        tok[m['yes_token']] = (m['cond'], 'yes'); tok[m['no_token']] = (m['cond'], 'no')
    out = []
    for f in aux['fills']:
        if f['match_time'] < RESTART: continue
        cond, outc = tok[f['token']]
        p, sz = float(f['price']), float(f['size'])
        side = (1 if f['side'] == 'BUY' else -1) * (1 if outc == 'yes' else -1)
        qy = p if outc == 'yes' else 1 - p
        out.append(dict(cond=cond, ts=pd.Timestamp(f['match_time']).timestamp(), side=side, qy=round(qy, 4), size=sz, outcome=outc,
                        oside=f['side'], trader=f['trader_side']))
    return sorted(out, key=lambda f: f['ts'])

def mid_at(M, t, after=True):
    j = np.searchsorted(M.t, t) if after else np.searchsorted(M.t, t, side='right') - 1
    rng = range(j, min(j + 30, len(M.t))) if after else range(j, max(j - 30, -1), -1)
    for jj in rng:
        if 0 <= jj < len(M.t) and not np.isnan(M.mid[jj]): return float(M.mid[jj])
    return None

def classify(M, f):
    """LP-SPEED's classes on one fill: A a taker print moved toward the order between the turn's decision and the fill,
    B the fill's taker went through our price (a sweep), C our order was behind the others' touch, D at or inside it."""
    ts = f['ts']; td = int((ts - 7) // 60)
    i = M.index.get(td)
    bb = ba = None
    if i is not None: bb, ba = M.bb[i], M.ba[i]
    pr = M.pr
    want = -1 if f['side'] == 1 else 1        # a taker SELL of YES meets our bid
    near = pr[(pr[:, 0] >= ts - 3) & (pr[:, 0] <= ts + 10) & (pr[:, 1] == want)] if len(pr) else np.zeros((0, 4))
    through = [p for p in near if (p[2] < f['qy'] - 1e-6 if f['side'] == 1 else p[2] > f['qy'] + 1e-6)]
    before = pr[(pr[:, 0] > td * 60 + 7) & (pr[:, 0] < ts - 1) & (pr[:, 1] == want)] if len(pr) else []
    if bb is None or (np.isnan(bb) if f['side'] == 1 else np.isnan(ba)): where = 'no book'
    elif f['side'] == 1: where = 'inside' if f['qy'] > bb + 1e-9 else ('at touch' if abs(f['qy'] - bb) < 1e-9 else 'behind')
    else: where = 'inside' if f['qy'] < ba - 1e-9 else ('at touch' if abs(f['qy'] - ba) < 1e-9 else 'behind')
    if len(before): c = 'A'
    elif through: c = 'B'
    elif where == 'behind': c = 'C'
    else: c = 'D'
    nb = lambda x: None if x is None or np.isnan(x) else float(x)
    return c, where, nb(bb), nb(ba), float(near[:, 3].sum()) if len(near) else 0.0

def book_pnl(fl, bc, at):
    """Each market's fills: cash, position, realised P&L (average cost), and the P&L at the cleaned mid of minute `at`."""
    pm = collections.defaultdict(lambda: dict(cash=0.0, net=0.0, sh=0.0, n=0, real=0.0, cost=0.0))
    for f in fl:
        b = pm[f['cond']]
        dq = f['side'] * f['size']
        if b['net'] != 0 and (b['net'] > 0) != (dq > 0):
            red = min(abs(b['net']), abs(dq)); avg = b['cost'] / b['net']
            b['real'] += red * (f['qy'] - avg) * (1 if b['net'] > 0 else -1)
            b['cost'] -= avg * red * (1 if b['net'] > 0 else -1)
            b['cost'] += np.sign(dq) * (abs(dq) - red) * f['qy']
        else:
            b['cost'] += dq * f['qy']
        b['net'] += dq; b['cash'] -= dq * f['qy']; b['sh'] += f['size']; b['n'] += 1
    for cond, b in pm.items():
        b['end_mid'] = mid_at(engine.market(bc[cond]), at, after=False)
        b['pnl'] = b['cash'] + b['net'] * (b['end_mid'] or 0)
    return pm

def live():
    aux, rows = load_live()
    bc = by_cond()
    picks = live_picks(aux, rows)
    print(f"Q2-PM, the live record {iso(T0)} -> {iso(T1)} UTC ({(T1 - T0 + 1) / 60:.1f} hours; restart {RESTART})\n")
    print("== the picks (rank > 12: a refill), from selection to replacement")
    for p in picks:
        p['mid'] = bc.get(p['cond'])
        print(f"  {p['day'][5:]} #{p['rank']:>2} {p['cond'][:10]} {iso(p['start'])} -> {iso(p['end'])}  rate {p['rate']:>3} v {p['v']}  {p['q']}")
    rmap = collections.defaultdict(dict)
    for x in rows:
        m = x[0] // 60
        if T0 <= m <= T1: rmap[x[1]][m] = x
    cls = collections.Counter()
    for p in picks:
        c = collections.Counter(); F = 0.0
        for m in range(max(p['start'], T0), min(p['end'], T1 + 1)):
            x = rmap[p['cond']].get(m)
            if x is None: c['no row'] += 1; continue
            st, out = x[18], x[20] or ''
            bid, ask = x[10] is not None, x[12] is not None
            w = None if x[6] is None or x[7] is None else (x[7] - x[6]) * 100
            if st == 'quote':
                k = 'resting both sides' if bid and ask else 'resting one side' if bid or ask else ('nothing: touch under 4 c' if w is not None and w < 4 - 1e-9 else 'nothing: other')
            elif st == 'carried':
                k = ('out: rate under the floor' if 'under the floor' in out else 'out: programme ended' if 'ended' in out else
                     'out: replaced' if 'replaced' in out else 'carried: ' + out[:40])
                if bid or ask: k += ' (exit resting)'
            else:
                k = st + (' (exit resting)' if bid or ask else '')
            c[k] += 1; F += x[16] or 0.0
        p['minutes'] = dict(c); p['formula'] = F
        cls.update(c)
    slot = sum(cls.values())
    print(f"\n== the picks' selected minutes ({slot} pick-minutes, {slot / (T1 - T0 + 1):.1f} picks on average), by what rested")
    for k, v in cls.most_common():
        print(f"  {v:>6}  {100 * v / slot:5.1f} %  {k}")
    F = collections.defaultdict(float); mins2 = collections.Counter()
    for x in rows:
        m = x[0] // 60
        if not (T0 <= m <= T1): continue
        d = lib.day_of_min(m)
        F[d] += x[16] or 0.0
        if x[14] and x[15]: mins2[d] += 1
    rd = [r for r in aux['reward_days'] if r['day'] >= D13]
    paid = {d: sum(r['actual_usd'] or 0 for r in rd if r['day'] == d) for d in (D13, D14)}
    reb = {d: sum(r['rebate_usd'] or 0 for r in rd if r['day'] == d) for d in (D13, D14)}
    form_rd = {d: sum(r['formula_usd'] or 0 for r in rd if r['day'] == d) for d in (D13, D14)}
    R = paid[D13] / form_rd[D13] if form_rd[D13] else float('nan')
    print(f"\n== rewards: formula (the live code's) {D13} {F[D13]:.3f} (reward days {form_rd[D13]:.3f}), {D14} to {iso(T1)} {F[D14]:.3f}; paid {D13} "
          f"{paid[D13]:.3f} (R {R:.3f}); rebates {D13} {reb[D13]:.3f}; minutes with both sides scoring {dict(mins2)}")
    fl = fills_yes(aux)
    print(f"\n== the fills: {len(fl)}, {sum(f['size'] for f in fl):.0f} shares (YES terms: bid = a BUY of YES or a SELL of NO)")
    for f in fl:
        mid = bc.get(f['cond']); M = engine.market(mid)
        c, where, bb, ba, tsz = classify(M, f)
        tm = int(f['ts'] // 60)
        mk = {}
        for h in (1, 5, 15, 60):
            mm = mid_at(M, tm + h)
            mk[h] = None if mm is None else f['side'] * (mm - f['qy']) * f['size']
        f.update(mid=mid, cls=c, where=where, bb=bb, ba=ba, taker_size=tsz, mk=mk)
        mks = ' '.join(f"m{h} {('%+.2f' % v) if v is not None else '  n/a'}" for h, v in mk.items())
        print(f"  {iso(tm)} {f['cond'][:10]} {'bid' if f['side'] == 1 else 'ask'} {f['qy']:.3f} x{f['size']:>3.0f} ({f['oside']} {f['outcome']:<3}) "
              f"others' touch {bb if bb is not None else float('nan'):.3f}/{ba if ba is not None else float('nan'):.3f} {where:<8} {c}  taker {tsz:5.1f} sh  {mks}")
    print("\n  by class (LP-SPEED's): fills, shares; markout at 1 / 5 / 60 minutes ($, the cleaned mid)")
    for c in 'ABCD':
        g = [f for f in fl if f['cls'] == c]
        if not g: continue
        s = {h: sum(f['mk'][h] for f in g if f['mk'][h] is not None) for h in (1, 5, 60)}
        print(f"    {c}: {len(g):>2} fills, {sum(f['size'] for f in g):>4.0f} shares; {s[1]:+.2f} / {s[5]:+.2f} / {s[60]:+.2f}")
    for w in ('inside', 'at touch', 'behind', 'no book'):
        g = [f for f in fl if f['where'] == w]
        if g: print(f"    {w}: {len(g)} fills, {sum(f['size'] for f in g):.0f} shares, m60 {sum(f['mk'][60] or 0 for f in g):+.2f}")
    pm = book_pnl(fl, bc, T1)
    print("\n  each market: the fills' P&L at the end mark (the cleaned mid at the window's last minute), realised, held")
    for cond, b in sorted(pm.items(), key=lambda kv: kv[1]['pnl']):
        print(f"    {cond[:10]} fills {b['n']:>2} shares {b['sh']:>4.0f}  P&L {b['pnl']:+6.2f}  realised {b['real']:+6.2f}  held {b['net']:+5.0f} YES, mid {b['end_mid']}")
    tot = sum(b['pnl'] for b in pm.values()); real = sum(b['real'] for b in pm.values())
    sh = sum(f['size'] for f in fl)
    print(f"  total {tot:+.2f} (realised {real:+.2f}); {D13}'s rewards {paid[D13]:.3f} + rebates {reb[D13]:.3f} = {100 * (paid[D13] + reb[D13]) / sh:.2f} c "
          f"a filled share ({100 * paid[D13] / sh:.2f} c rewards alone; the bar is 1.5 c of rewards)")
    json.dump(dict(picks=picks, classes=dict(cls), formula=dict(F), paid=paid, rebates=reb, formula_rd=form_rd, R=R,
                   fills=fl, markets={k: dict(v) for k, v in pm.items()}, fills_pnl=tot, realised=real, shares=sh),
              open(OUT('live'), 'w'), default=float)

# -------------------------------------------------------------------------------------------------------------- run
def engine_state(M, i, quoting_since, pause_until, pol):
    """What the engine's rule says of one selected minute, in the order it checks."""
    if i is None or np.isnan(M.mid[i]) or np.isnan(M.m[i]): return 'no book', pause_until
    rate = M.rate[i]; N = M.Nmin[i]
    if not ((rate >= pol['min_rate']) and (N <= pol['max_n']) and not np.isnan(M.v[i])): return 'out: rate under the floor', pause_until
    t = int(M.t[i])
    if pol['jump_c'] and M.jump[i] >= pol['jump_c'] - 1e-9: pause_until = t + pol['jump_min']
    if t < pause_until: return 'paused', pause_until
    if M.width_c[i] < pol['min_width_c'] - 1e-9: return 'touch under 4 c', pause_until
    return 'entries allowed', pause_until

def live_class(x):
    if x is None: return 'no row'
    st, out = x[18], x[20] or ''
    bid, ask = x[10] is not None, x[12] is not None
    w = None if x[6] is None or x[7] is None else (x[7] - x[6]) * 100
    if st == 'quote':
        if bid or ask: return 'resting'
        return 'touch under 4 c' if w is not None and w < 4 - 1e-9 else 'nothing: other'
    if st == 'carried':
        return 'out: rate under the floor' if ('under the floor' in out or 'ended' in out) else 'out: other'
    return st

def picks_of(L, mode):
    """The live picks as engine picks [(mid, rank, start, end)]: 'designed' keeps each day's first twelve from their
    selection to the day's end (the engine's model: a dip stops entries while it lasts); 'run' takes every pick, refills
    included, from its selection to its replacement, as live did."""
    out = []
    for p in L['picks']:
        if p['mid'] is None: continue
        if mode == 'designed':
            if p['rank'] > 12: continue
            out.append((p['mid'], p['rank'], p['start'], mi(p['day'] + 'T00:00:00Z') + 1440))
        else:
            out.append((p['mid'], p['rank'], p['start'], p['end']))
    return out

def run():
    L = json.load(open(OUT('live')))
    aux, rows = load_live()
    rmap = collections.defaultdict(dict)
    for x in rows:
        m = x[0] // 60
        if T0 <= m <= T1: rmap[x[1]][m] = x
    pol = q2_policy()
    print(f"Q2-PM, the engine on the live window {iso(T0)} -> {iso(T1)} UTC with the live picks (Q2 at ${EQ:.0f}: cap ${runs.cap_of(EQ):.0f}; "
          f"R_engine {engine.calib().get('R_engine'):.3f}, k_vol {engine.calib()['k_vol']:.3f})\n")
    # 1. minute by minute: the engine's own gate against live's, over every pick's selected span
    conf = collections.Counter(); eng_tot = collections.Counter(); live_tot = collections.Counter()
    for p in L['picks']:
        if p['mid'] is None: continue
        M = engine.market(p['mid']); pu = -1
        for m in range(max(p['start'], T0), min(p['end'], T1 + 1)):
            e, pu = engine_state(M, M.index.get(m), p['start'], pu, pol)
            l = live_class(rmap[p['cond']].get(m))
            conf[(l, e)] += 1; eng_tot[e] += 1; live_tot[l] += 1
    print("== 1. each selected pick-minute: live's state (rows) against the engine's gate on pm-rec's book and listing (columns)")
    ecols = ['entries allowed', 'touch under 4 c', 'paused', 'out: rate under the floor', 'no book']
    print(f"  {'live \\ engine':<28}" + ''.join(f"{c[:16]:>18}" for c in ecols) + f"{'total':>9}")
    for l, n in live_tot.most_common():
        print(f"  {l:<28}" + ''.join(f"{conf[(l, c)]:>18}" for c in ecols) + f"{n:>9}")
    print(f"  {'total':<28}" + ''.join(f"{eng_tot[c]:>18}" for c in ecols) + f"{sum(eng_tot.values()):>9}")
    # 2. the engine as designed and as run
    out = {}
    for mode in ('designed', 'run'):
        res = run_segments(pol, picks_of(L, mode), T0, T1)
        out[mode] = res
    print("\n== 2. the engine over the window, the live picks (rewards at R_engine; fills at the cleaned mid of the last minute)")
    print(f"  {'':<44}{'total':>8}{'rewards':>9}{'formula':>9}{'fills':>8}{'rebates':>9}{'shares':>8}{'fills#':>7}{'2-sided min':>12}")
    def line(lab, r):
        m2 = sum(b['minutes2'] for b in r['books'].values())
        print(f"  {lab:<44}{r['total']:>+8.2f}{r['paid']:>9.3f}{r['formula2']:>9.3f}{r['fills_pnl']:>+8.2f}{r['rebate']:>9.3f}{r['shares']:>8.0f}{r['fills']:>7}{m2:>12}")
    line('as designed (each day\'s 12, all day)', out['designed'])
    line('as run (refills; each pick to its replacement)', out['run'])
    lv_paid = L['paid'][D13] + L['formula'].get(D14, 0.0) * L['R']
    print(f"  {'live':<44}{lv_paid + L['rebates'][D13] + L['fills_pnl']:>+8.2f}{lv_paid:>9.3f}{sum(L['formula'].values()):>9.3f}{L['fills_pnl']:>+8.2f}"
          f"{L['rebates'][D13]:>9.3f}{L['shares']:>8.0f}{len(L['fills']):>7}{sum(1 for x in rows if T0 <= x[0] // 60 <= T1 and x[14] and x[15]):>12}")
    print(f"  (live rewards: 10-13's payout {L['paid'][D13]:.3f} + 10-14's formula to {iso(T1)} {L['formula'].get(D14, 0):.3f} x live R {L['R']:.3f}; "
          f"10-14's rebates not yet read. The engine's formula is two-sided only; live's formula column is the live code's.)")
    # 3. market by market, as run against live
    print("\n== 3. market by market, the engine as run against live: two-sided scoring minutes, formula, fills (shares, $ at the end mark)")
    r = out['run']
    print(f"  {'cond':<11}{'eng 2s':>7}{'live 2s':>8}{'eng F':>8}{'live F':>8}{'eng sh':>8}{'live sh':>8}{'eng $':>8}{'live $':>8}")
    lmin2 = collections.Counter(x[1] for x in rows if T0 <= x[0] // 60 <= T1 and x[14] and x[15])
    lF = collections.defaultdict(float)
    for x in rows:
        if T0 <= x[0] // 60 <= T1: lF[x[1]] += x[16] or 0
    bc = by_cond()
    tab = []
    for p in L['picks']:
        if p['mid'] is None: continue
        b = r['books'].get(p['mid'], {}); lm = L['markets'].get(p['cond'], {})
        tab.append((p['cond'], b.get('minutes2', 0), lmin2[p['cond']], b.get('formula2', 0.0), lF[p['cond']], b.get('shares', 0.0), lm.get('sh', 0.0), b.get('pnl', 0.0), lm.get('pnl', 0.0)))
    for t in sorted(tab, key=lambda t: -(t[4] + t[3])):
        print(f"  {t[0][:10]:<11}{t[1]:>7}{t[2]:>8}{t[3]:>8.3f}{t[4]:>8.3f}{t[5]:>8.1f}{t[6]:>8.0f}{t[7]:>+8.2f}{t[8]:>+8.2f}")
    # 4. one assumption at a time, on the as-run schedule
    print("\n== 4. one switch at a time on the as-run schedule (engine $ over the window)")
    alts = [('as run (Q2 as live)', {}),
            ('no x2 pause', dict(jump_c=None)),
            ('pause stops entries only (exits rest)', dict(pause_exits=True)),
            ('pause on the raw mid', dict(pause_raw=True)),
            ('touch >= 3 c', dict(min_width_c=3)),
            ('touch >= 5 c', dict(min_width_c=5)),
            ('touch >= 6 c', dict(min_width_c=6)),
            ('no touch rule (TB1 2 ticks)', dict(min_width_c=0, min_width_ticks=2))]
    sw = {}
    for lab, kw in alts:
        rr = run_segments(q2_policy(**kw), picks_of(L, 'run'), T0, T1)
        sw[lab] = summary(rr, (T1 - T0 + 1) / 1440)
        line(lab, rr)
    # 5. where the formula went: the stateless formula of RW's quote of N a side (daytable.py's, every selected minute the
    # engine's gate allows entries) against live's own formula, both summed by live's state that minute
    print("\n== 5. the formula by live's state (selected pick-minutes): the engine's stateless formula where its gate allows entries, live's own")
    fe = collections.Counter(); fl = collections.Counter(); ne = collections.Counter()
    own_left = collections.Counter()
    for p in L['picks']:
        if p['mid'] is None: continue
        M = engine.market(p['mid'])
        b, a = M.placed('inside'); N = M.Nmin
        q1, q2 = M.score(b, a, N, N)
        two = np.minimum(q1, q2)
        f2 = np.where(two > 0, np.nan_to_num(M.rate) / 1440 * two / (two + M.others), 0.0)
        pu = -1
        for m in range(max(p['start'], T0), min(p['end'], T1 + 1)):
            i = M.index.get(m)
            e, pu = engine_state(M, i, p['start'], pu, pol)
            x = rmap[p['cond']].get(m)
            l = live_class(x)
            if x is not None and x[10] is not None and x[12] is not None and l == 'resting':
                l = 'resting both sides' + (', both scoring' if x[14] and x[15] else ', not both scoring')
            elif l == 'resting': l = 'resting one side'
            if e == 'entries allowed' and i is not None: fe[l] += float(np.nan_to_num(f2[i])); ne[l] += 1
            if x is not None: fl[l] += x[16] or 0.0
    print(f"  {'live state':<44}{'eng min':>8}{'eng F':>9}{'live F':>9}")
    for l in sorted(set(fe) | set(fl), key=lambda k: -fe[k]):
        print(f"  {l:<44}{ne[l]:>8}{fe[l]:>9.3f}{fl[l]:>9.3f}")
    print(f"  {'total':<44}{sum(ne.values()):>8}{sum(fe.values()):>9.3f}{sum(fl.values()):>9.3f}")
    # 6. x2's pause replayed on live's own minute rows (the others' adjusted touch, ab/aa, as the live code judged it):
    # how many of the picks' selected minutes each rule pauses, and the engine's stateless formula in the minutes it pauses
    print("\n== 6. x2's pause replayed on live's minute rows (the others' size-adjusted touch live judged): selected pick-minutes paused, and the formula in them")
    def replay(seq, kind):
        last = None; until = -1; paused = set(); pend = None
        for j, (m, ab, aa, bb, ba) in enumerate(seq):
            lo_, hi_ = (ab, aa) if kind != 'raw' else (bb, ba)
            mid = (lo_ + hi_) / 2 if lo_ is not None and hi_ is not None else None
            if kind == 'hold2' and pend is not None:
                # a jump counts only when the next read still stands 15 c or more from the mid before the jump
                if mid is not None and abs(mid - pend) * 100 >= 15 - 1e-9: until = m + 60
                pend = None
            if mid is not None:
                if last is not None and abs(mid - last) * 100 >= 15 - 1e-9:
                    if kind == 'hold2': pend = last
                    else: until = m + 60
                last = mid
            if m < until: paused.add(m)
        return paused
    fpm = {}
    for p in L['picks']:
        if p['mid'] is None: continue
        M = engine.market(p['mid'])
        b_, a_ = M.placed('inside'); N = M.Nmin
        q1, q2 = M.score(b_, a_, N, N); two = np.minimum(q1, q2)
        f2 = np.where(two > 0, np.nan_to_num(M.rate) / 1440 * two / (two + M.others), 0.0)
        for m in range(max(p['start'], T0), min(p['end'], T1 + 1)):
            i = M.index.get(m)
            fpm[(p['cond'], m)] = float(np.nan_to_num(f2[i])) if i is not None else 0.0
    pz = {}
    for kind in ('as live (adjusted, at once)', 'raw touch mid', 'hold2'):
        tot_m = 0; tot_f = 0.0
        for p in L['picks']:
            seq = [(m, rmap[p['cond']][m][8], rmap[p['cond']][m][9], rmap[p['cond']][m][6], rmap[p['cond']][m][7]) for m in sorted(rmap[p['cond']])]
            ps = replay(seq, 'raw' if kind == 'raw touch mid' else 'hold2' if kind == 'hold2' else 'adj')
            sel = [m for m in range(max(p['start'], T0), min(p['end'], T1 + 1)) if m in ps]
            tot_m += len(sel); tot_f += sum(fpm.get((p['cond'], m), 0.0) for m in sel)
        pz[kind] = (tot_m, tot_f)
        lab = {'hold2': 'a jump that still stands a minute later'}.get(kind, kind)
        print(f"  {lab:<48} {tot_m:>5} minutes paused, engine formula in them {tot_f:.3f}")
    print(f"  (live's rows say 'paused' in {live_tot.get('paused', 0)} selected minutes)")
    json.dump(dict(conf={f'{a}|{b}': v for (a, b), v in conf.items()}, designed=summary(out['designed'], (T1 - T0 + 1) / 1440),
                   run=summary(out['run'], (T1 - T0 + 1) / 1440), table=tab, switches=sw, formula_eng=dict(fe), formula_live=dict(fl), minutes_eng=dict(ne), pause_replay=pz,
                   books_run={str(k): v for k, v in out['run']['books'].items()}),
              open(OUT('run'), 'w'), default=float)

# ------------------------------------------------------------------------------------------------------------- prog
def reads_of(mid):
    a = lib.prog_all()['reads'].get(mid)
    return a if a is not None and len(a) else None

def rate_at(a, t):
    """The listing's rate in force at minute t (its last read at or before t; None before the first)."""
    j = np.searchsorted(a[:, 0], t, side='right') - 1
    return None if j < 0 else float(a[j, 1])

def runs_under(ts, rs, floor, t_end):
    """Each run of reads under the floor: (start, minutes until a read at or over it, censored at t_end)."""
    out = []; s = None
    for t, r in zip(ts, rs):
        if r < floor and s is None: s = t
        elif r >= floor and s is not None: out.append((s, t - s, False)); s = None
    if s is not None: out.append((s, t_end - s, True))
    return out

def clob_reward(cond):
    import urllib.request
    req = urllib.request.Request(f'https://clob.polymarket.com/rewards/markets/{cond}', headers={'User-Agent': 'curl/8.5.0', 'Accept': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(req, timeout=20))
    except Exception as e:
        return {'error': type(e).__name__}

def prog():
    df = strat.daytable()
    print("Q2-PM, the programmes: how often a market's daily reward rate moves within a UTC day (pm-rec's listing reads, every market "
          "every 15 minutes; live's reward check every minute), whether our quoting moves it, and what the CLOB says now\n")
    groups = {'TRAIN 10-05..08': strat.DAYS[:4], 'TEST 10-09..12': strat.DAYS[4:], '10-13': [D13]}
    sets = {
        'every market >= $10, N <= 50 at 00:00': lambda d: df[(df.day == d) & (df.rate0 >= 10)],
        'Q2 quiet candidates (touch >= 4 c, <= 50 sh)': lambda d: strat.eligible(df[df.day == d], min_width_c=4, max_api_vol=50),
        "Q2's picks (the engine's, 00:00)": lambda d: pd.DataFrame(q2_select(df[df.day == d])),
    }
    print("== 1. within a UTC day, per market-day (the listing's reads of that day)")
    print(f"  {'set':<46}{'days':<17}{'mkt-days':>9}{'moved':>8}{'chg/day':>8}{'>=10 chg':>9}{'dipped<$10':>11}{'reads<$10':>10}{'end<half':>9}")
    stats = {}
    for sname, f in sets.items():
        for gname, ds in groups.items():
            n = mv = ten = dip = 0; chg = []; under = []; half = 0
            for d in ds:
                x = f(d); d0 = strat.D0[d]
                for mid, r0 in zip(x.mid.astype(int), x.rate0):
                    a = reads_of(mid)
                    if a is None: continue
                    sel = (a[:, 0] >= d0) & (a[:, 0] < d0 + 1440)
                    rs = a[sel, 1]
                    if len(rs) < 40: continue
                    c = int((np.diff(rs) != 0).sum())
                    n += 1; mv += c > 0; ten += c >= 10; chg.append(c); dip += (rs < 10).any(); under.append(float((rs < 10).mean()))
                    half += rs[-1] < 0.5 * r0
            stats[(sname, gname)] = dict(n=n, moved=mv / max(n, 1), chg_med=float(np.median(chg)) if chg else 0, ten=ten / max(n, 1), dip=dip / max(n, 1),
                                         under=float(np.mean(under)) if under else 0, half=half / max(n, 1))
            s = stats[(sname, gname)]
            print(f"  {sname:<46}{gname:<17}{n:>9}{100 * s['moved']:>7.0f}%{s['chg_med']:>8.0f}{100 * s['ten']:>8.0f}%{100 * s['dip']:>10.0f}%{100 * s['under']:>9.0f}%{100 * s['half']:>8.0f}%")
    # 2. how long a dip under $10 lasts: the listing's reads (quiet candidates) and live's minute reads (our picks)
    print("\n== 2. how long a dip under the $10 floor lasts")
    dur = []
    for d in strat.DAYS + [D13]:
        x = strat.eligible(df[df.day == d], min_width_c=4, max_api_vol=50); d0 = strat.D0[d]
        for mid in x.mid.astype(int):
            a = reads_of(mid)
            if a is None: continue
            sel = (a[:, 0] >= d0) & (a[:, 0] < d0 + 1440)
            if sel.sum() < 40: continue
            dur += runs_under(a[sel, 0], a[sel, 1], 10, d0 + 1440)
    def dline(lab, dd):
        if not dd: print(f"  {lab}: none"); return {}
        L_ = np.array([x[1] for x in dd]); cz = np.array([x[2] for x in dd])
        q = {k: float(np.mean((L_ <= k) & ~cz)) for k in (15, 30, 60, 120, 240)}
        print(f"  {lab}: {len(dd)} dips; back at or over $10 within 15 min {100 * q[15]:.0f} %, 30 {100 * q[30]:.0f} %, 60 {100 * q[60]:.0f} %, "
              f"2 h {100 * q[120]:.0f} %, 4 h {100 * q[240]:.0f} %; still under at the day's end {100 * cz.mean():.0f} %; median {np.median(L_):.0f} min")
        return dict(n=len(dd), back=q, censored=float(cz.mean()), median=float(np.median(L_)))
    dl = dline("listing, Q2 quiet candidates 10-05 -> 10-13 (15-minute reads)", dur)
    aux, rows = load_live()
    L = json.load(open(OUT('live')))
    seq = collections.defaultdict(list)
    for x in rows:
        if x[0] // 60 >= T0 and x[24] is not None: seq[x[1]].append((x[0] // 60, float(x[24])))
    ldur = []; ivals = []; nchg = 0; nmin = 0
    for c, s in seq.items():
        s.sort()
        ts = [t for t, r in s]; rs = [r for t, r in s]
        ldur += runs_under(ts, rs, 10, T1 + 1)
        ch = [ts[i] for i in range(1, len(rs)) if rs[i] != rs[i - 1]]
        ivals += list(np.diff(ch)); nchg += len(ch); nmin += len(ts)
    ll = dline("live's minute reads, every market it read since the restart", ldur)
    print(f"  live's reads: {nchg} changes in {nmin} market-minutes read (one every {nmin / max(nchg, 1):.0f} minutes); median gap between changes "
          f"{np.median(ivals) if ivals else float('nan'):.0f} min")
    # 3. does our quoting move the rate? Each live join (a market's first live order of a UTC day, every live path since
    # 10-08) against the day's other quiet candidates at the same minute, in two strata of where the rate stood against
    # the market's own last 24 hours (we pick markets whose rate is up: what comes after is partly a return)
    print("\n== 3. does our joining move the rate? the listing's rate after each live join against the same day's other quiet candidates at the same minute")
    lo = json.load(gzip.open(os.path.join(lib.WORK, 'live_orders.json.gz'), 'rt'))['rows']
    bc = by_cond()
    joins = {}
    for o in lo:
        if o[1] is None or o[6] == 'rejected': continue
        t = int(float(o[1]) // 60); d = lib.day_of_min(t)
        k = (o[0], d)
        if k not in joins or t < joins[k]: joins[k] = t
    ours_by_day = collections.defaultdict(set)
    for (c, d) in joins: ours_by_day[d].add(c)
    OFF = (60, 120, 240)
    def path(a, t):
        r0 = rate_at(a, t)
        if r0 is None or r0 < 10: return None
        sel = (a[:, 0] >= t - 1440) & (a[:, 0] < t)
        med = float(np.median(a[sel, 1])) if sel.sum() >= 20 else None
        out = {'r0': r0, 'up': (med is not None and r0 > med * 1.0001)}
        for k in OFF:
            rk = rate_at(a, t + k)
            if rk is None: return None
            sel2 = (a[:, 0] > t) & (a[:, 0] <= t + k)
            out[k] = (math.log(max(rk, 0.5) / r0), bool((a[sel2, 1] < 10).any()))
        return out
    ev = []; ctl = collections.defaultdict(list)
    cand = {d: strat.eligible(df[df.day == d], min_width_c=4, max_api_vol=50) for d in ALLDAYS if d in set(df.day)}
    for (c, d), t in sorted(joins.items(), key=lambda kv: kv[1]):
        mid = bc.get(c)
        if mid is None or t + 240 > T1: continue
        a = reads_of(mid)
        if a is None: continue
        p = path(a, t)
        if p is None: continue
        ev.append((c, d, t, p))
        if d in cand:
            for m2, c2 in zip(cand[d].mid.astype(int), cand[d].cond):
                if c2 in ours_by_day[d]: continue
                a2 = reads_of(m2)
                if a2 is None: continue
                p2 = path(a2, t)
                if p2 is not None: ctl[(c, d)].append(p2)
    print(f"  {len(ev)} joins with a rate >= $10 and 4 hours of reads after them (10-08 -> {iso(T1)}), each against the day's other quiet candidates")
    res3 = {}
    for stratum in ('all', 'rate above its 24 h median', 'rate at or below it'):
        rows3 = []
        for (c, d, t, p) in ev:
            if stratum != 'all' and (p['up'] != (stratum == 'rate above its 24 h median')): continue
            cs = [q for q in ctl.get((c, d), []) if stratum == 'all' or q['up'] == p['up']]
            if not cs: continue
            rows3.append((p, cs))
        if not rows3: continue
        line_ = f"  {stratum:<30} n {len(rows3):>3}:"
        r3 = {}
        for k in OFF:
            ours_l = np.array([p[k][0] for p, cs in rows3]); ours_d = np.array([p[k][1] for p, cs in rows3])
            ctl_l = np.array([np.mean([q[k][0] for q in cs]) for p, cs in rows3]); ctl_d = np.array([np.mean([q[k][1] for q in cs]) for p, cs in rows3])
            diff = ours_l - ctl_l
            rnd = np.random.default_rng(20261014); bs = diff[rnd.integers(0, len(diff), size=(2000, len(diff)))].mean(1)
            lo5, hi95 = np.percentile(bs, [5, 95])
            r3[k] = dict(ours_log=float(ours_l.mean()), ctl_log=float(ctl_l.mean()), diff=float(diff.mean()), lo=float(lo5), hi=float(hi95),
                         ours_dip=float(ours_d.mean()), ctl_dip=float(ctl_d.mean()))
            line_ += (f"  +{k // 60}h: ours {100 * (math.exp(ours_l.mean()) - 1):+.0f} % vs {100 * (math.exp(ctl_l.mean()) - 1):+.0f} % "
                      f"(diff {diff.mean():+.2f} log [{lo5:+.2f}, {hi95:+.2f}]); dipped {100 * ours_d.mean():.0f} % vs {100 * ctl_d.mean():.0f} %")
        res3[stratum] = r3
        print(line_)
    # 4. the CLOB now: each programme's start date, for the day's quiet candidates and our picks
    print("\n== 4. the CLOB's /rewards/markets/{condition_id} now: each config's start date")
    now_day = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    x14 = strat.eligible(df[df.day == D14], min_width_c=4, max_api_vol=50)
    conds = list(dict.fromkeys(list(x14.cond) + [p['cond'] for p in L['picks']]))
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(6) as ex:
        reps = dict(zip(conds, ex.map(clob_reward, conds)))
    sd = collections.Counter(); ncfg = collections.Counter(); ids = 0; nread = 0
    for c, r in reps.items():
        rowsc = (r or {}).get('data') or []
        if not rowsc: sd['no programme listed' if 'error' not in r else 'read failed'] += 1; continue
        nread += 1
        cfg = rowsc[0].get('rewards_config') or []
        ncfg[len(cfg)] += 1
        for k in cfg:
            s_ = (k.get('start_date') or '')[:10]
            sd['today (' + now_day + ')' if s_ == now_day else ('yesterday' if s_ == (pd.Timestamp(now_day) - pd.Timedelta(days=1)).strftime('%Y-%m-%d') else 'earlier' if s_ < now_day else 'later')] += 1
    print(f"  {len(conds)} markets read ({len(x14)} quiet candidates of 10-14 and the live picks), {nread} with a programme: start dates {dict(sd)}; configs a market {dict(ncfg)}")
    json.dump(dict(within=dict((f'{a}|{b}', v) for (a, b), v in stats.items()), dips_listing=dl, dips_live=ll, live_changes=nchg, live_minutes=nmin,
                   join_study=res3, clob_start=dict(sd), clob_cfgs=dict(ncfg), clob_read_at=datetime.now(timezone.utc).isoformat()),
              open(OUT('prog'), 'w'), default=float)

# -------------------------------------------------------------------------------------------------------------- opt
def prog_features(x, d):
    """Knowable at the day's 00:00 from the listing's reads: the share of the last 1, 2 and 3 days' reads at or over $10
    (a market the listing did not show reads as under), and the last 24 hours' mean rate."""
    d0 = strat.D0[d]; s1 = []; s2 = []; s3 = []; m24 = []
    for mid in x.mid.astype(int):
        a = reads_of(mid)
        if a is None: s1.append(np.nan); s2.append(np.nan); s3.append(np.nan); m24.append(np.nan); continue
        for n, lst in ((1, s1), (2, s2), (3, s3)):
            sel = (a[:, 0] >= d0 - 1440 * n) & (a[:, 0] < d0)
            # every read of the span: a 15-minute phase the market missed counts as under (its share of 96 reads a day)
            lst.append(float((a[sel, 1] >= 10).sum()) / (96 * n))
        sel = (a[:, 0] >= d0 - 1440) & (a[:, 0] < d0)
        m24.append(float(a[sel, 1].sum()) / 96)
    return x.assign(s1=np.minimum(s1, 1), s2=np.minimum(s2, 1), s3=np.minimum(s3, 1), m24=m24)

def q2_cands(day_df, min_width_c=4):
    x = strat.eligible(day_df, min_width_c=min_width_c, max_api_vol=50)
    return prog_features(x, day_df.day.iloc[0]) if len(x) else x

RANKS = {
    'rw': lambda x: x.est0 / x.cap0,
    'rw x survive': lambda x: x.est0 * x.s1.fillna(0) / x.cap0,
    'rw at 24h mean rate': lambda x: x.est0 * (x.m24.fillna(0) / x.rate0) / x.cap0,
    'rw at 24h mean rate x survive': lambda x: x.est0 * (x.m24.fillna(0) / x.rate0) * x.s1.fillna(0) / x.cap0,
}

def day_lists(d, k=12, rank='rw', stable=None, min_width_c=4, eq=EQ):
    df = strat.daytable()
    x = q2_cands(df[df.day == d], min_width_c)
    if not len(x): return [], []
    if stable:
        col, th = stable
        x = x[x[col].fillna(0) >= th]
    s = RANKS[rank](x)
    picks = strat.choose(x, s, 0.9 * runs.cap_of(eq), k)
    pm = {int(r.mid) for r in picks}
    rest = x.assign(score=s).sort_values(['score', 'cond'], ascending=[False, True])
    reserve = [int(m) for m, sc in zip(rest.mid, rest.score) if int(m) not in pm and sc > 0]
    return [int(r.mid) for r in picks], reserve

def build(days, mode='keep', max_refills=10, out_wait=15, floor=10.0, t_end=None, **kw):
    """The day's picks and, by the live rule, its refills: a pick whose programme (the listing's rate in force, the
    engine's own `M.rate`) is under the floor or asks N > 20 for `out_wait` minutes is replaced by the reserve's next market
    whose programme is in force (at most `max_refills` a day), and is not taken again that day ('live'; 'retake': it goes
    back to the reserve); 'keep' keeps every pick all day, entries stopping while its programme is out (the engine's model)."""
    E = engine_x()
    out = []
    for d in days:
        d0 = strat.D0[d]; dend = min(d0 + 1440, (t_end + 1) if t_end else d0 + 1440)
        picks, reserve = day_lists(d, **kw)
        slots = [dict(mid=m, rank=i + 1, start=d0, end=None, out=None) for i, m in enumerate(picks)]
        if mode == 'keep' or not picks:
            out += [(s['mid'], s['rank'], s['start'], dend) for s in slots]; continue
        def ok(mid, t):
            M = E.market(mid); i = M.index.get(t)
            if i is None: return None
            return bool(M.rate[i] >= floor and M.Nmin[i] <= 20 and not np.isnan(M.v[i]))
        taken = set(picks); n_ref = 0; rank = len(picks)
        for t in range(d0, dend):
            for s in list(slots):
                if s['end'] is not None: continue
                o = ok(s['mid'], t)
                if o is None: continue
                if o: s['out'] = None; continue
                if s['out'] is None: s['out'] = t
                if t - s['out'] >= out_wait and n_ref < max_refills:
                    nxt = None
                    for c in reserve:
                        if c in taken: continue
                        if ok(c, t): nxt = c; break
                    if nxt is None: continue
                    s['end'] = t; n_ref += 1; rank += 1
                    if mode == 'live': taken.add(nxt)
                    else: taken.discard(s['mid']); taken.add(nxt)
                    slots.append(dict(mid=nxt, rank=rank, start=t, end=None, out=None))
        out += [(s['mid'], s['rank'], s['start'], s['end'] if s['end'] is not None else dend) for s in slots]
    return out

def price_cand(label, days, pol, picks, t0, t1, cfs=()):
    res = run_segments(pol, picks, t0, t1)
    nd = (t1 - t0 + 1) / 1440
    s = summary(res, nd)
    # the same bootstrap with the rewards scaled by each calibration factor (a market-day's rewards x c + rebates + fills)
    s['cal_ranges'] = {}
    for c in cfs:
        lo, hi = boot([c * v[0] + v[1] + v[2] for v in res['md_day'].values()])
        s['cal_ranges'][f'{c:.4f}'] = (lo / nd, hi / nd)
    daily = collections.defaultdict(float)
    for (mid, d), v in res['md_day'].items(): daily[d] += sum(v)
    s.update(label=label, worst=min(daily.values()) if daily else 0.0, daily=dict(daily), markets=len(res['books']), refills=sum(1 for p in picks if p[1] > 12))
    return s

CANDS = [
    # label, build kwargs, policy kwargs
    ('Q2 as live (drop on a dip, 10 refills, no retake)', dict(mode='live'), {}),
    ("Q2 as LP-BEST priced it (keep the picks all day)", dict(mode='keep'), {}),
    ('refills: none (a dipped pick keeps its slot)', dict(mode='live', max_refills=0), {}),
    ('refills: 5', dict(mode='live', max_refills=5), {}),
    ('refills: 20', dict(mode='live', max_refills=20), {}),
    ('refills: wait 60 min, not 15', dict(mode='live', out_wait=60), {}),
    ('re-take a market whose rate comes back', dict(mode='retake'), {}),
    ('keep + stable 1 d (>= 90 % of reads >= $10)', dict(mode='keep', stable=('s1', 0.9)), {}),
    ('keep + stable 2 d (>= 90 %)', dict(mode='keep', stable=('s2', 0.9)), {}),
    ('keep + stable 3 d (>= 90 %)', dict(mode='keep', stable=('s3', 0.9)), {}),
    ('keep + stable 1 d (>= 75 %)', dict(mode='keep', stable=('s1', 0.75)), {}),
    ('keep, rank rw x P(survive 24 h)', dict(mode='keep', rank='rw x survive'), {}),
    ('keep, rank at the 24 h mean rate', dict(mode='keep', rank='rw at 24h mean rate'), {}),
    ('keep, rank at the 24 h mean rate x P(survive)', dict(mode='keep', rank='rw at 24h mean rate x survive'), {}),
    ('keep, pause stops entries only', dict(mode='keep'), dict(pause_exits=True)),
    ('keep, pause on the raw mid', dict(mode='keep'), dict(pause_raw=True)),
    ('keep, no pause', dict(mode='keep'), dict(jump_c=None)),
    ('keep, touch >= 3 c', dict(mode='keep', min_width_c=3), dict(min_width_c=3)),
    ('keep, touch >= 5 c', dict(mode='keep', min_width_c=5), dict(min_width_c=5)),
    ('keep, touch >= 6 c', dict(mode='keep', min_width_c=6), dict(min_width_c=6)),
    ('keep, 6 markets', dict(mode='keep', k=6), {}),
    ('keep, 8 markets', dict(mode='keep', k=8), {}),
    ('keep, floor $5 (entries while >= $5)', dict(mode='keep'), dict(min_rate=5)),
    ('keep + stable 2 d + rank at mean rate x P', dict(mode='keep', stable=('s2', 0.9), rank='rw at 24h mean rate x survive'), {}),
]

def _job(args):
    label, bkw, pkw, span, cfs = args
    if span == 'record':
        days, t0, t1 = strat.DAYS, strat.D0[strat.DAYS[0]], strat.D0[strat.DAYS[-1]] + 1439
    else:
        days, t0, t1 = [D13, D14], strat.D0[D13], T1
    picks = build(days, t_end=t1, **bkw)
    s = price_cand(label, days, q2_policy(**pkw), picks, t0, t1, cfs)
    s['span'] = span
    if span == 'record':
        for nm, ds in (('train', strat.DAYS[:4]), ('test', strat.DAYS[4:])):
            s[nm] = sum(s['daily'].get(d, 0.0) for d in ds) / len(ds)
    return s

def opt():
    from multiprocessing import Pool
    run_ = json.load(open(OUT('run'))); L = json.load(open(OUT('live')))
    # calibration to live day 1, on the as-run schedule over the live window: rewards (live paid over the engine's), and the
    # same with the minutes live sat paused taken out of the engine's formula (live's rewards if its pause tripped no more
    # often than the engine's does); fills and rebates as the engine has them (it had live's fills within $0.76)
    lv_paid = L['paid'][D13] + L['formula'].get(D14, 0.0) * L['R']
    c_rew = lv_paid / run_['run']['paid']
    fe = run_['formula_eng']; fe_tot = sum(fe.values())
    c_rew_np = lv_paid / (run_['run']['paid'] * (1 - fe.get('paused', 0.0) / fe_tot))
    jobs = [(lab, b, p, span, (c_rew, c_rew_np)) for span in ('record', 'day1') for (lab, b, p) in CANDS]
    with Pool(4) as pool:
        out = pool.map(_job, jobs, chunksize=1)
    print("Q2-PM, the candidates through the engine (Q2's policy at $316 unless named; market-day bootstrap 5-95 %)\n")
    print(f"Calibration to live day 1 (the as-run schedule, {iso(T0)} -> {iso(T1)}): rewards x {c_rew:.2f} (live's pause as it trips), "
          f"x {c_rew_np:.2f} if live's pause tripped no more than the engine's; fills and rebates x 1.00 (engine {run_['run']['fills']:+.2f} / live {L['fills_pnl']:+.2f})\n")
    for span, title in (('record', '10-05 -> 10-12, the record (8 days): $ a day'), ('day1', f'10-13 00:00 -> {iso(T1)}, live day 1 (26 hours, 00:00 day tables): $ over the span')):
        print(f"== {title}")
        print(f"  {'':<52}{'raw':>8}{'[5 %':>8}{'95 %]':>8}{'rew':>7}{'fills':>7}{'reb':>6}{'sh':>6}{'c/sh':>6}{'worst':>7}{'calib':>8}{'[5 %':>8}{'95 %]':>8}{'cal np':>8}{'[5 %':>8}{'95 %]':>8}"
              + (f"{'TRAIN':>7}{'TEST':>7}" if span == 'record' else ''))
        for s in [o for o in out if o['span'] == span]:
            nd = 1 if span == 'day1' else 8
            v = lambda k: s[k] / nd if span == 'record' else s[k]
            lo = s['lo'] if span == 'record' else s['lo'] * (T1 - strat.D0[D13] + 1) / 1440
            hi = s['hi'] if span == 'record' else s['hi'] * (T1 - strat.D0[D13] + 1) / 1440
            cal = v('fills') + v('rebate') + c_rew * v('paid')
            np_ = v('fills') + v('rebate') + c_rew_np * v('paid')
            csh = 100 * c_rew * s['paid'] / s['shares'] if s['shares'] else float('nan')
            s.update(cal=cal, cal_np=np_, c_per_share_cal=csh)
            sc = 1 if span == 'record' else (T1 - strat.D0[D13] + 1) / 1440
            (cl, ch), (nl, nh) = [tuple(x * sc for x in s['cal_ranges'][f'{c:.4f}']) for c in (c_rew, c_rew_np)]
            print(f"  {s['label'][:52]:<52}{v('total'):>+8.2f}{lo:>+8.2f}{hi:>+8.2f}{v('paid'):>7.2f}{v('fills'):>+7.2f}{v('rebate'):>6.2f}{v('shares'):>6.0f}"
                  f"{csh:>6.2f}{s['worst']:>+7.2f}{cal:>+8.2f}{cl:>+8.2f}{ch:>+8.2f}{np_:>+8.2f}{nl:>+8.2f}{nh:>+8.2f}" +(f"{s['train']:>+7.2f}{s['test']:>+7.2f}" if span == 'record' else ''))
        print()
    print("  c/sh: rewards at the calibrated R per filled share, in cents (the bar is 1.5). calib: rewards x the live calibration, "
          "fills and rebates as the engine has them; cal np: the same if live's pause tripped no more than the engine's.")
    json.dump(dict(c_rew=c_rew, c_rew_np=c_rew_np, cands=out), open(OUT('opt'), 'w'), default=float)

if __name__ == '__main__':
    globals()[sys.argv[1]]()
