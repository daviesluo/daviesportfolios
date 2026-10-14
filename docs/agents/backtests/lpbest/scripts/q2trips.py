# Q2-TRIPS (2026-10-14): every round trip Q2 made since its restart (2026-10-13 13:25:32 UTC, live-prep's Addenda 19-22),
# lot by lot, and the last set of entry/exit rules priced on LP-BEST's engine calibrated to live. Read-only: the live record
# as saved replies (Q2PM_LIVE: live_aux.json, live_minutes.json.gz, live_orders.json.gz from sql/q2pm_live.sql, run again
# 10-14 ~16:15 UTC), pm-rec's archive through q2pm_data.py's work folder extended to 10-14 15:59 (LPBEST_WORK), the data
# API's prints (keyless).
#   LPBEST_WORK=<work> LPBEST_API_TAPE=1 Q2PM_LIVE=<dir> python3 -I -W ignore docs/agents/backtests/lpbest/scripts/q2trips.py <step>
# Steps (each writes <work>/q2trips_<step>.json; results/q2trips_<step>.txt is the print):
#   tape   the data API's prints 2026-10-12 00:00 -> 10-14 16:00 for every market live quoted since the restart and every
#          Q2 candidate of 10-13 / 10-14, merged into the folder's prints_api.pkl
#   trips  every lot (FIFO, YES terms): entry, the book and the mid then, what printed through us, the mid after 1 / 5 /
#          15 / 60 / 240 minutes, the exit and how it rested, the hold, pauses held through, adds; the fills' P&L split
#          into entry edge, the first minute, the drift while held, the exit edge, and by cause
#   calib  q2pm.py's live and run steps over the longer window (to 10-14 15:59): the calibration of the engine to live
#   opt    the rules (a)-(g) through the engine, on 10-05 -> 10-12 and on the live window, raw and calibrated
import os, sys, json, gzip, re, math, bisect, collections, pickle
from datetime import datetime, timezone
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, engine, strat, runs, q2pm
from engine import P

LIVE = os.environ.get('Q2PM_LIVE', '')
OUT = lambda name: os.path.join(lib.WORK, f'q2trips_{name}.json')
mi, iso = q2pm.mi, q2pm.iso
T0 = q2pm.T0
T1 = mi('2026-10-14T16:00:00Z') - 1        # the archive's last closed minute when this ran
q2pm.T1 = T1
A22 = mi('2026-10-14T03:45:00Z')           # Addendum 22 (no refills) live from about here

def tape():
    import apitape
    T0s, T1s = int(pd.Timestamp('2026-10-12T00:00:00Z').timestamp()), int(pd.Timestamp('2026-10-14T16:00:00Z').timestamp())
    apitape.T0 = T0s
    md = lib.meta(); bc = {m['cond']: i for i, m in md.items()}
    mids = set()
    df = pd.read_csv(os.path.join(lib.WORK, 'daytable_api.csv.gz'), low_memory=False)
    for d in (q2pm.D13, q2pm.D14):
        mids |= set(int(m) for m in strat.eligible(df[df.day == d], min_width_c=3).mid)
    aux = json.load(open(os.path.join(LIVE, 'live_aux.json')))
    for m in aux['markets']:
        if m['cond'] in bc: mids.add(bc[m['cond']])
    mids = sorted(mids)
    from concurrent.futures import ThreadPoolExecutor
    def one(mid):
        rows = apitape.fetch(md[mid]['cond'])
        if rows is None: return mid, None, 0
        pr = set()
        for r in rows:
            ts = int(r['timestamp'])
            if not (T0s <= ts < T1s): continue
            oi = int(r.get('outcomeIndex', 0)); p = float(r['price']); s = float(r['size'])
            buy = r['side'] == 'BUY'
            if oi == 1: buy = not buy; p = 1 - p
            pr.add((ts, 1 if buy else -1, p, s, r.get('transactionHash', '')))
        return mid, np.array(sorted((a, b, c, d) for (a, b, c, d, h) in pr), np.float64).reshape(-1, 4), len(rows)
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(one, mids))
    p = os.path.join(lib.WORK, 'prints_api.pkl')
    old = pickle.load(open(p, 'rb')) if os.path.exists(p) else {}
    for mid, arr, n in res:
        if arr is None: continue
        prev = old.get(mid)
        keep = prev[prev[:, 0] < T0s] if prev is not None and len(prev) else np.zeros((0, 4))
        old[mid] = np.vstack([keep, arr]) if len(keep) else arr
    pickle.dump(old, open(p, 'wb'), protocol=5)
    failed = [mid for mid, arr, n in res if arr is None]
    print(f"{len(mids)} markets asked; {len(mids) - len(failed)} read; {len(failed)} failed; {sum(len(a) for m, a, n in res if a is not None)} prints in the window")

# ------------------------------------------------------------------------------------------------------------ trips
def lots_of(fl):
    """FIFO lots per market in YES terms: an entry opens or adds to a position; a reducing fill closes the oldest lot first
    (a lot split across exits keeps each part)."""
    out = []; open_ = collections.defaultdict(list)
    for f in fl:
        q = f['size']; c = f['cond']
        while q > 1e-9 and open_[c] and open_[c][0]['side'] != f['side']:
            L = open_[c][0]; take = min(q, L['left'])
            L['exits'].append(dict(ts=f['ts'], qy=f['qy'], size=take)); L['left'] -= take; q -= take
            if L['left'] <= 1e-9: open_[c].pop(0)
        if q > 1e-9:
            held_same = sum(x['left'] for x in open_[c])
            L = dict(cond=c, side=f['side'], ts=f['ts'], qy=f['qy'], size=q, left=q, exits=[], add=held_same > 1e-9, fill=f)
            open_[c].append(L); out.append(L)
    return out

def trips():
    aux, rows = q2pm.load_live()
    bc = q2pm.by_cond()
    rmap = collections.defaultdict(dict)
    for x in rows: rmap[x[1]][x[0] // 60] = x
    fl = q2pm.fills_yes(aux)
    lots = lots_of(fl)
    def row(c, m):
        for k in range(0, 3):
            x = rmap[c].get(m - k)
            if x is not None: return x
        return None
    def mid_live(c, m):
        x = row(c, m)
        if x is None or x[6] is None or x[7] is None: return None
        return (x[6] + x[7]) / 2
    def mid_any(c, m):
        v = mid_live(c, m)
        if v is not None: return v
        M = engine.market(bc[c]); return q2pm.mid_at(M, m)
    print(f"Q2-TRIPS, every lot since the restart ({iso(T0)} -> {iso(T1)} UTC; fills to {datetime.fromtimestamp(fl[-1]['ts'], timezone.utc).strftime('%m-%d %H:%M')}), "
          f"YES terms: +1 a long YES (a BUY of YES or a SELL of NO), -1 a short\n")
    comp = collections.Counter(); bycause = collections.defaultdict(float); n_by = collections.Counter()
    recs = []
    for L in lots:
        c = L['cond']; s = L['side']; M = engine.market(bc[c])
        te = int(L['ts'] // 60)
        x0 = row(c, te)
        bb, ba = (x0[6], x0[7]) if x0 is not None else (None, None)
        me = mid_any(c, te)
        cls, where, cbb, cba, tsz = q2pm.classify(M, L['fill'])
        path = {h: mid_any(c, te + h) for h in (1, 5, 15, 60, 240)}
        # exit: the size-weighted exit price and time, else the mark at the window's end (held)
        if L['exits']:
            q = sum(e['size'] for e in L['exits']); xq = sum(e['qy'] * e['size'] for e in L['exits']) / q
            tx = int(max(e['ts'] for e in L['exits']) // 60); closed = L['left'] <= 1e-9
        else:
            q = 0; xq = None; tx = None; closed = False
        held_q = L['left']
        mark = mid_any(c, T1) if held_q > 1e-9 else None
        # how the exit rested: our order at the exit minute against the others' touch, and the market's state then
        how = None
        if tx is not None:
            xr = row(c, tx)
            if xr is not None:
                ours = xr[12] if s == 1 else xr[10]
                oth = xr[7] if s == 1 else xr[6]
                how = (f"{xr[18]}; ours {ours} vs others' {'ask' if s == 1 else 'bid'} {oth}" if ours is not None else f"{xr[18]}")
        # pauses and carried minutes while the lot was open; minutes with no exit resting while held
        end = tx if tx is not None else T1
        st = collections.Counter(); noexit = 0
        for m in range(te, end + 1):
            xr = rmap[c].get(m)
            if xr is None: continue
            st[xr[18]] += 1
            if (xr[12] if s == 1 else xr[10]) is None: noexit += 1
        pnl_closed = (s * (xq - L['qy']) * q) if q else 0.0
        pnl_held = (s * (mark - L['qy']) * held_q) if held_q > 1e-9 and mark is not None else 0.0
        size = L['size']
        m1 = path[1] if path[1] is not None else me
        mx = mid_any(c, tx) if tx is not None else mark
        # the split of the lot's P&L (closed part at its exits, held part at the end mark), each share once:
        #   entry edge  s (mid at entry - entry) ; first minute  s (mid +1 - mid at entry) ; drift  s (mid at exit - mid +1)
        #   exit edge  s (exit - mid at exit) (0 for the part still held, marked at the mid)
        parts = {}
        if me is not None and m1 is not None and mx is not None:
            parts['entry edge'] = s * (me - L['qy']) * size
            parts['first minute'] = s * (m1 - me) * size
            parts['drift while held'] = s * (mx - m1) * size
            parts['exit edge'] = s * (xq - mx) * q if q else 0.0
        tot = pnl_closed + pnl_held
        parts['residual'] = tot - sum(parts.values())
        for k, v in parts.items(): comp[k] += v
        cause = ('an add (bought while already holding that way)' if L['add'] else 'a first lot')
        bycause[cause] += tot; n_by[cause] += 1
        paused_min = st.get('paused', 0)
        bycause['held through x2\'s pause (any minute)' if paused_min else 'never paused while held'] += tot
        n_by['held through x2\'s pause (any minute)' if paused_min else 'never paused while held'] += 1
        bycause[f'entry class {cls}'] += tot; n_by[f'entry class {cls}'] += 1
        rec = dict(cond=c, side=s, entry=L['qy'], size=size, t=te, bb=bb, ba=ba, mid=me, cls=cls, where=where, taker=tsz, path=path, exit=xq, tx=tx,
                   closed=closed, held=held_q, mark=mark, how=how, hold_min=(end - te), states=dict(st), noexit=noexit, add=L['add'], pnl=tot, parts=parts)
        recs.append(rec)
        f2 = lambda v: '  n/a' if v is None else f"{v:.3f}"
        print(f"{c[:10]} {'long ' if s == 1 else 'short'} {size:>4.0f} @ {L['qy']:.3f}  {iso(te)}  book {f2(bb)}/{f2(ba)} mid {f2(me)}  {where:<8} class {cls}"
              f"  taker {tsz:5.1f}{'  ADD' if L['add'] else ''}")
        print(f"      mid +1 {f2(path[1])} +5 {f2(path[5])} +15 {f2(path[15])} +60 {f2(path[60])} +240 {f2(path[240])}")
        print(f"      exit {f2(xq)} x{q:.0f} at {iso(tx) if tx else '  (held)'}  ({how})  held {end - te} min; states {dict(st)}; minutes with no exit resting {noexit}"
              f"{'' if held_q <= 1e-9 else f'; {held_q:.0f} still held, marked {f2(mark)}'}")
        print(f"      P&L {tot:+.2f}  = " + ' '.join(f"{k} {v:+.2f}" for k, v in parts.items()))
    tot = sum(r['pnl'] for r in recs)
    print(f"\n== {len(recs)} lots, {sum(r['size'] for r in recs):.0f} shares; fills P&L {tot:+.2f} (closed at their exits, held at the mid of {iso(T1)})")
    print("  the split (each share once):")
    for k in ('entry edge', 'first minute', 'drift while held', 'exit edge', 'residual'):
        print(f"    {k:<20}{comp[k]:+8.2f}")
    print("  by cause (a lot can be in several rows):")
    for k in sorted(bycause, key=lambda k: bycause[k]):
        print(f"    {k:<52} {n_by[k]:>3} lots  {bycause[k]:+7.2f}")
    # exits: where they rested against the others' touch and the mid, closed lots only
    cl = [r for r in recs if r['exit'] is not None]
    ex_mid = sum(r['parts'].get('exit edge', 0) for r in cl)
    print(f"  exits: {len(cl)} lots exited; exit edge against the mid at the exit minute {ex_mid:+.2f}; median hold "
          f"{np.median([r['hold_min'] for r in cl]):.0f} min; held through a pause {sum(1 for r in recs if r['states'].get('paused'))} lots")
    adv = [r for r in recs if r['path'][60] is not None and r['mid'] is not None]
    print(f"  the mid 60 minutes after entry moved against the lot in {sum(1 for r in adv if r['side'] * (r['path'][60] - r['mid']) < -1e-9)} of {len(adv)} lots, "
          f"with it in {sum(1 for r in adv if r['side'] * (r['path'][60] - r['mid']) > 1e-9)}")
    json.dump(dict(lots=recs, split=dict(comp), bycause=dict(bycause), n=dict(n_by), total=tot), open(OUT('trips'), 'w'), default=float)

# ------------------------------------------------------------------------------------------------------------ calib
def calib():
    """q2pm.py's live and run steps over the window to 10-14 15:59 (its outputs are q2pm_live.json / q2pm_run.json in this
    folder): the engine on live's own picks and schedule against live, the factor its rewards are scaled by below."""
    q2pm.live()
    print('\n' + '=' * 120 + '\n')
    q2pm.run()

# -------------------------------------------------------------------------------------------------------------- opt
# The engine with the switches the rules need, made as q2pm.py makes its own: exact substitutions of engine.py's source
# (each must match once) on top of q2pm's three (pause_exits, pause_raw, the raw jump). New here:
#   tp_ticks, tp_until  the reducing side rests at the position's average entry + tp_ticks ticks (a long sells there, a
#                       short buys there), never crossing the others' touch, for tp_until minutes from the position's
#                       opening, then RW's exit as before (tp_until None: always)
#   taker_after         a position open this many minutes is sold at the others' touch as a taker, the taker fee paid
#   quiet_min           an entry rests only when the market's tape printed nothing in the last quiet_min minutes
#   (a position's opening minute is kept on the book: `opened`, unused by engine.py)
_EY = None
def engine_y():
    global _EY
    if _EY is not None: return _EY
    src = open(engine.__file__).read()
    subs = [
        ("            if paused: rest_any = False\n",
         "            if paused: rest_any = bool(policy.get('pause_exits'))\n"),
        ("            if quoting and policy['jump_c'] and M.jump[i] >= policy['jump_c'] - 1e-9:\n",
         "            if quoting and policy['jump_c'] and (M.jump_raw if policy.get('pause_raw') else M.jump)[i] >= policy['jump_c'] - 1e-9:\n"),
        ("    M.jump = np.nan_to_num(jump)\n",
         "    M.jump = np.nan_to_num(jump)\n    jr = np.zeros(len(mid)); jr[1:] = np.abs(np.diff(mid)) * 100\n"
         "    jr[1:][(M.t[1:] - M.t[:-1]) > 5] = 0\n    M.jump_raw = np.nan_to_num(jr)\n"
         "    pmin = np.unique(np.floor(M.pr[:, 0] / 60).astype(np.int64)) if len(M.pr) else np.zeros(0, np.int64)\n"
         "    jj = np.searchsorted(pmin, M.t, side='left') - 1\n"
         "    M.since_print = np.where(jj >= 0, M.t - pmin[np.maximum(jj, 0)], 10 ** 6) if len(pmin) else np.full(len(M.t), 10 ** 6)\n"),
        ("def P(**kw):\n",
         "def _tp_exit(policy, M, b, i, side, px, t):\n"
         "    tp = policy.get('tp_ticks')\n"
         "    if tp is None or abs(b.net) < 1e-9 or b.cost <= 0: return px\n"
         "    if policy.get('tp_until') is not None and b.opened is not None and t - b.opened >= policy['tp_until']: return px\n"
         "    tk = M.tick[i]\n"
         "    if side == -1:\n"
         "        q = math.ceil((b.cost / b.net + tp * tk) / tk - 1e-9) * tk\n"
         "        if not np.isnan(M.bb[i]): q = max(q, M.bb[i] + tk)\n"
         "        return min(q, 1 - tk)\n"
         "    q = math.floor(((1 - b.cost / (-b.net)) - tp * tk) / tk + 1e-9) * tk\n"
         "    if not np.isnan(M.ba[i]): q = min(q, M.ba[i] - tk)\n"
         "    return max(q, tk)\n\n"
         "def P(**kw):\n"),
        ("                    bid = (xb[i], min(Q, -net), False)\n",
         "                    bid = (_tp_exit(policy, M, b, i, 1, xb[i], t), min(Q, -net), False)\n"),
        ("                    ask = (xa[i], min(Q, net), False)\n",
         "                    ask = (_tp_exit(policy, M, b, i, -1, xa[i], t), min(Q, net), False)\n"),
        ("                    b.net += dq; b.cash -= dq * px\n                    if abs(b.net) < 1e-9: b.net = 0.0; b.cost = 0.0\n",
         "                    b.net += dq; b.cash -= dq * px\n                    if abs(b.net) < 1e-9: b.net = 0.0; b.cost = 0.0\n"
         "                    if abs(b.net) < 1e-9: b.opened = None\n                    elif b.opened is None: b.opened = t\n"),
        ("            entry_ok = quoting and not paused\n",
         "            if policy.get('taker_after') is not None and b.opened is not None and t - b.opened >= policy['taker_after'] and abs(b.net) >= 1e-9:\n"
         "                tp_ = M.bb[i] if b.net > 0 else M.ba[i]\n"
         "                if not np.isnan(tp_):\n"
         "                    fr_, sh_ = lib.fee_and_share(M.meta.get('fee'))\n"
         "                    q_ = abs(b.net); b.fees += fr_ * tp_ * (1 - tp_) * q_; b.cash -= fr_ * tp_ * (1 - tp_) * q_\n"
         "                    b.cash += b.net * tp_; b.net = 0.0; b.cost = 0.0; b.opened = None\n"
         "                    b.shares += q_; daily[d]['taker_sh'] += q_\n"
         "                    mark_adj = b.cash\n"
         "            entry_ok = quoting and not paused\n"),
        ("            if entry_ok and policy['range_c'] is not None",
         "            if entry_ok and policy.get('quiet_min') and M.since_print[i] < policy['quiet_min']: entry_ok = False\n"
         "            if entry_ok and policy['range_c'] is not None"),
    ]
    for a, b in subs:
        assert src.count(a) == 1, a
        src = src.replace(a, b)
    import types
    mod = types.ModuleType('engine_y'); mod.__file__ = engine.__file__
    exec(compile(src, engine.__file__ + ' (q2trips substitutions)', 'exec'), mod.__dict__)
    _EY = mod
    return mod

RULES = [
    # label, policy kwargs (on Q2 as live now: Addendum 21's exits, the 4 c touch, x2's pause, no refills)
    ('Q2 as live now (2N, RW exits, no refills)', {}),
    ('(a) N cap: inv_cap 1 (no averaging into a position)', dict(inv_cap=1)),
    ('(b) take-profit +1 tick, RW exit after 30 min', dict(tp_ticks=1, tp_until=30)),
    ('(b) take-profit +1 tick, RW exit after 120 min', dict(tp_ticks=1, tp_until=120)),
    ('(b) scratch (exit at entry), RW exit after 30 min', dict(tp_ticks=0, tp_until=30)),
    ('(b) take-profit +1 tick, taker stop at 30 min', dict(tp_ticks=1, taker_after=30)),
    ('(b) take-profit +1 tick, taker stop at 120 min', dict(tp_ticks=1, taker_after=120)),
    ('(b) time stop alone: taker at 30 min', dict(taker_after=30)),
    ('(b) time stop alone: taker at 120 min', dict(taker_after=120)),
    ('(c) per-market stop: no buy after -$1', dict(loss_guard=1.0)),
    ('(c) per-market stop: no buy after -$2', dict(loss_guard=2.0)),
    ('(d) one side once held: inv_cap 0.01', dict(inv_cap=0.01)),
    ('(e) band edge: 2 c from the adjusted mid', dict(place='dist', dist=2.0)),
    ('(e) band edge: 3 c from the adjusted mid', dict(place='dist', dist=3.0)),
    ('(e) band edge: 4 c from the adjusted mid', dict(place='dist', dist=4.0)),
    ('(e) band edge: 5 c from the adjusted mid', dict(place='dist', dist=5.0)),
    ('(e) join the touch, not a tick inside', dict(place='join')),
    ('(f) no print in the last 30 min', dict(quiet_min=30)),
    ('(f) no print in the last 120 min', dict(quiet_min=120)),
    ('(f) no print in the last 360 min', dict(quiet_min=360)),
    ('(g) N cap + one side + no print 120 min', dict(inv_cap=0.01, quiet_min=120)),
    ('(g) one side + take-profit +1, RW after 30', dict(inv_cap=0.01, tp_ticks=1, tp_until=30)),
    ('(g) band edge 3 c + one side', dict(place='dist', dist=3.0, inv_cap=0.01)),
    ('(g) band edge 3 c + one side + no print 120', dict(place='dist', dist=3.0, inv_cap=0.01, quiet_min=120)),
    ('(g) band edge 4 c + one side', dict(place='dist', dist=4.0, inv_cap=0.01)),
    ('(g) band edge 4 c + no print 120 min', dict(place='dist', dist=4.0, quiet_min=120)),
]

def _opt_job(args):
    label, kw, span, cfs = args
    q2pm.engine_x = engine_y          # every q2pm run below goes through the extended engine
    pol = q2pm.q2_policy(**kw)
    if span == 'record':
        days, t0, t1 = strat.DAYS, strat.D0[strat.DAYS[0]], strat.D0[strat.DAYS[-1]] + 1439
        picks = q2pm.build(days, mode='keep', t_end=t1)
    else:
        L = json.load(open(q2pm.OUT('live')))
        t0, t1 = T0, T1; days = None
        picks = q2pm.picks_of(L, 'run')
    s = q2pm.price_cand(label, days, pol, picks, t0, t1, cfs)
    s['span'] = span
    if span == 'record':
        for nm, ds in (('train', strat.DAYS[:4]), ('test', strat.DAYS[4:])):
            s[nm] = sum(s['daily'].get(d, 0.0) for d in ds) / len(ds)
    return s

def opt():
    from multiprocessing import Pool
    run_ = json.load(open(q2pm.OUT('run'))); L = json.load(open(q2pm.OUT('live')))
    lv_paid = L['paid'][q2pm.D13] + L['formula'].get(q2pm.D14, 0.0) * L['R']
    c_rew = lv_paid / run_['run']['paid']
    # the fills: live lost more per filled share than the engine on the same schedule; that gap is charged on every share
    # a rule fills (a per-share penalty, so a rule that fills less is charged less, and one that wins keeps its sign)
    pen = L['fills_pnl'] / L['shares'] - run_['run']['fills'] / run_['run']['shares']
    jobs = [(lab, kw, span, (c_rew,)) for span in ('record', 'live') for (lab, kw) in RULES]
    with Pool(4) as pool:
        out = pool.map(_opt_job, jobs, chunksize=1)
    span_days = (T1 - T0 + 1) / 1440
    print("Q2-TRIPS, entry and exit rules through LP-BEST's engine (Q2 at $316 as live runs it now: Addenda 19-22; market-day bootstrap 5-95 %)\n")
    print(f"Calibration to live ({iso(T0)} -> {iso(T1)}, the engine on live's own picks and schedule): rewards x {c_rew:.2f} (live {lv_paid:.3f} "
          f"against the engine's {run_['run']['paid']:.3f}); fills: the engine's plus {100 * pen:+.2f} c on every filled share (live {L['fills_pnl']:+.2f} on "
          f"{L['shares']:.0f} shares against the engine's {run_['run']['fills']:+.2f} on {run_['run']['shares']:.0f}); rebates as the engine has them\n")
    for span, title in (('record', '10-05 -> 10-12 (8 days; each day\'s 00:00 picks kept all day): $ a day'),
                        ('live', f'the live window {iso(T0)} -> {iso(T1)} ({span_days:.2f} days, live\'s own picks and schedule): $ over the window')):
        print(f"== {title}")
        print(f"  {'':<50}{'raw':>8}{'[5 %':>8}{'95 %]':>8}{'rew':>7}{'fills':>8}{'reb':>6}{'sh':>6}{'calib':>8}{'[5 %':>8}{'95 %]':>8}{'c/sh':>6}{'worst':>8}"
              + (f"{'TRAIN':>7}{'TEST':>7}" if span == 'record' else ''))
        for s in [o for o in out if o['span'] == span]:
            nd = 8 if span == 'record' else 1
            sc = 1 if span == 'record' else span_days
            v = lambda k: s[k] / nd
            cal = v('fills') + v('rebate') + c_rew * v('paid') + pen * v('shares')
            cl, ch = [x * sc + pen * v('shares') for x in s['cal_ranges'][f'{c_rew:.4f}']]
            csh = 100 * c_rew * s['paid'] / s['shares'] if s['shares'] else float('nan')
            s.update(cal=cal, cal_lo=cl, cal_hi=ch, c_per_share=csh)
            print(f"  {s['label'][:50]:<50}{v('total'):>+8.2f}{s['lo'] * sc:>+8.2f}{s['hi'] * sc:>+8.2f}{v('paid'):>7.2f}{v('fills'):>+8.2f}{v('rebate'):>6.2f}"
                  f"{v('shares'):>6.0f}{cal:>+8.2f}{cl:>+8.2f}{ch:>+8.2f}{csh:>6.2f}{s['worst']:>+8.2f}" + (f"{s['train']:>+7.2f}{s['test']:>+7.2f}" if span == 'record' else ''))
        print()
    print("  calib: rewards x the live factor, fills charged the live penalty per filled share, rebates as the engine has them; c/sh: calibrated "
          "rewards per filled share, cents (bar 1.5). The calibrated range is the bootstrap's, shifted by the penalty.")
    json.dump(dict(c_rew=c_rew, pen=pen, rules=out), open(OUT('opt'), 'w'), default=float)

if __name__ == '__main__':
    globals()[sys.argv[1]]()
