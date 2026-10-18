# LIVE (PR5's executor on the `_2` sub-account, £10 a rung): the two changes Davies asked about on 2026-10-18, priced on
# LIVE's own record before anything is built.
#   (i)  TAKE's taker entry (variant-2's rule, `takeTriggered` / `takeLimitTicks` of agents/quotes_live.ts): at each of LIVE's
#        turns from 2026-10-04 16:00 (TAKE's start), on every rung LIVE did not hold and whose paper rung was not in a position,
#        the book recorder's last read (at most 90 s old) against the rung's limit, k + 0.09 % from fair. A take fills at the
#        touch (an IOC at the limit takes the resting price), pays the venue's 0.09 % rounded up to the penny, and then exits as
#        LIVE exits: a maker sell (buy) at fair, re-priced when fair moves over 0.05 %, filled by a print through it (or at it,
#        the second fill rule), or the 24-hour stop. Its value is the take trip less LIVE's own trips on that rung that it
#        would have displaced (entered while the take was held).
#   (ii) The weekend rule (PR5-W's, `xhold` of the 2026-10-18 review's replay): PR5's rule at LIVE's £10 a rung on PR5's own
#        record, with and without it; and the same replay's weekday figures beside LIVE's own, to say how far the replay's
#        fills are from LIVE's.
# Inputs: the 2026-10-18 review's data (docs/agents/backtests/scq_review/2026-10-18/data, results/page_pnl.json) and
# data/book_touch.txt.gz (sql/pull.sql). Writes results/results.json.
#   python3 -I scripts/replay_live.py ../scq_review/2026-10-18      (from docs/agents/backtests/livetw)
import sys, os, json, gzip, bisect, math, random, collections, datetime, statistics as st
REV = os.path.abspath(sys.argv[1])
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REV, 'scripts'))
import replay as RP
M, H, DAY, TICK = RP.M, RP.H, RP.DAY, RP.TICK
FEE, HALF = RP.FEE, RP.HALF
TAKE_FROM = 1791129600000   # 2026-10-04 16:00 UTC (take50's `take.from`)
END = 1792195200000         # 2026-10-17 00:00 UTC (trips that could close by the pull)
GBP_RUNG = 10.0
SEED = 20261018
iso = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime('%Y-%m-%d %H:%M')
day = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime('%Y-%m-%d')

mins, prints = RP.load()
# ---- the paper engine's rung states minute by minute (replay.py's run, exact against the engine, with a hook)
def paper_states():
    out = {}
    for b in RP.BOOKS:
        R = [{'side': s, 'k': k, 'mode': 'idle', 'o': None} for s in ('bid', 'ask') for k in (0.001, 0.002, 0.003)]
        lastX, lp = None, None
        P = prints[b]; pi = 0
        for (t, x, fu) in mins[b]:
            if x: lastX = x
            f = fu / x if (x and fu) else None
            lpb = lp
            for r in R:
                if r['mode'] in ('idle', 'quote'):
                    o = r['o']
                    if f is None:
                        if r['mode'] == 'quote': r['mode'], r['o'] = 'idle', None
                        continue
                    if r['mode'] == 'idle' or o is None:
                        r['o'] = {'side': r['side'], 'ticks': RP.qt(f, r['k'], r['side']), 'fairAt': f, 'live': t + M, 'state': 'pending'}; r['mode'] = 'quote'; continue
                    if o['state'] == 'rejected':
                        if abs(f / o['fairAt'] - 1) > 0.0005: o['ticks'] = RP.qt(f, r['k'], r['side']); o['fairAt'] = f
                        if not RP.blocks(o['side'], o['ticks'], lpb): o['live'] = t + M; o['state'] = 'pending'
                        continue
                    if abs(f / o['fairAt'] - 1) > 0.0005:
                        o['ticks'] = RP.qt(f, r['k'], r['side']); o['fairAt'] = f; o['live'] = t + M; o['state'] = 'pending'
                else:
                    o = r['o']; xs = 'ask' if r['side'] == 'bid' else 'bid'
                    if o is None:
                        if f is not None: r['o'] = {'side': xs, 'ticks': RP.et(f, r['side']), 'fairAt': f, 'live': t + M, 'state': 'pending'}
                    elif o['state'] == 'rejected':
                        if f is not None and abs(f / o['fairAt'] - 1) > 0.0005: o['ticks'] = RP.et(f, r['side']); o['fairAt'] = f
                        if not RP.blocks(o['side'], o['ticks'], lpb): o['live'] = t + M; o['state'] = 'pending'
                    elif f is not None and abs(f / o['fairAt'] - 1) > 0.0005:
                        o['ticks'] = RP.et(f, r['side']); o['fairAt'] = f; o['live'] = t + M; o['state'] = 'pending'
            for r in R:
                o = r['o']
                if o and o['state'] == 'pending' and o['live'] == t: o['state'] = 'rejected' if RP.blocks(o['side'], o['ticks'], lpb) else 'live'
            # what the executor reads after this minute: fair, and each rung's paper mode
            out[(b, t)] = (f, {(r['side'], r['k']): r['mode'] for r in R})
            mp = []
            while pi < len(P) and P[pi][0] < t + M:
                if P[pi][0] >= t: mp.append(P[pi])
                pi += 1
            if mp:
                qvol = sum(p[2] * p[1] * TICK for p in mp)
                for p in mp:
                    for r in R:
                        o = r['o']
                        if not o or o['state'] != 'live' or not RP.fills(o, p, 'through'): continue
                        if r['mode'] == 'quote':
                            if not lastX: continue
                            usd = min(100.0, 0.10 * qvol * lastX)
                            if usd <= 0: continue
                            r.update(mode='position', o=None, entry=o['ticks'] * TICK, tEntry=t)
                        elif r['mode'] == 'position':
                            r.update(mode='idle', o=None)
                lp = mp[-1]
            for r in R:
                if r['mode'] == 'position' and r['tEntry'] != t and t >= r['tEntry'] + DAY and lp: r.update(mode='idle', o=None)
    return out
PAPER = paper_states()

# ---- the book recorder's reads: book -> sorted [(ts, seen_until, bid, ask)]
READS = collections.defaultdict(list)
for l in gzip.open(os.path.join(HERE, 'data', 'book_touch.txt.gz'), 'rt'):
    l = l.strip()
    if not l: continue
    b, ts, su, bp, bq, ap, aq = l.split('|')
    READS[b].append((int(ts), int(su), round(float(bp) / TICK) if bp else None, round(float(ap) / TICK) if ap else None))
for b in READS: READS[b].sort()
RTS = {b: [r[0] for r in READS[b]] for b in READS}
def read_at(b, at):
    k = bisect.bisect_right(RTS[b], at) - 1
    if k < 0: return None
    r = READS[b][k]
    return r if r[1] >= at - 90e3 else None

# ---- LIVE's own trips (the page's, results/page_pnl.json) and the minutes it held each rung
PAGE = json.load(open(os.path.join(REV, 'results', 'page_pnl.json')))
LIVE = PAGE['live']['trips']
ms = lambda s: int(datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)
HELD = collections.defaultdict(list)
for t in LIVE: HELD[(t['book'], t['side'], round(t['k'], 4))].append((ms(t['tEntry']), ms(t['tExit']), t['pnlGbp']))
def live_holds(key, at): return any(a <= at < z for a, z, _ in HELD[key])

# ---- prints for the exit simulation
PT = {b: [p[0] for p in prints[b]] for b in prints}
def exit_sim(b, side, t0, entry, qty, fill):
    """A long (bid) or short (ask) from t0: maker exit at fair from the next minute, re-priced on 0.05 % moves, filled by a
    print through it (or at it, its aggressor opposite); else the 24-hour stop at the last print less fee and half spread."""
    xs = 'ask' if side == 'bid' else 'bid'
    o = None
    i = bisect.bisect_left(PT[b], t0)
    lastp = None
    for (t, x, fu) in mins[b]:
        if t <= t0 - t0 % M: continue
        f = PAPER.get((b, t), (None, None))[0]
        if o is None and f is not None: o = {'side': xs, 'ticks': RP.et(f, side), 'fairAt': f}
        elif o is not None and f is not None and abs(f / o['fairAt'] - 1) > 0.0005: o = {'side': xs, 'ticks': RP.et(f, side), 'fairAt': f}
        while i < len(prints[b]) and prints[b][i][0] < t + M:
            p = prints[b][i]; i += 1
            if p[0] < t: continue
            lastp = p
            if o is not None and RP.fills(o, p, fill):
                px = o['ticks'] * TICK
                return (t, px, 'maker', qty * (px - entry) if side == 'bid' else qty * (entry - px))
        if t >= t0 + DAY and lastp:
            c = lastp[1] * TICK
            px = c * (1 - FEE - HALF) if side == 'bid' else c * (1 + FEE + HALF)
            return (t, px, 'stop', (qty * (px - entry) if side == 'bid' else qty * (entry - px)))
    return None

def takes(fill):
    out = []
    holding = {}                                    # a take's own position blocks the rung until it exits
    for b in RP.BOOKS:
        for (t, x, fu) in mins[b]:
            if t < TAKE_FROM - 2 * M or t >= END: continue
            f, modes = PAPER.get((b, t), (None, None))
            if f is None: continue
            at = t + M + 27e3                         # LIVE's turn: in PR5's call of the next minute, after the paper engine
            r = read_at(b, at)
            if not r: continue
            for side in ('bid', 'ask'):
                for k in (0.001, 0.002, 0.003):
                    key = (b, side, k)
                    if modes[(side, k)] == 'position' or live_holds(key, at): continue
                    if key in holding and holding[key] > at: continue
                    limit = RP.qt(f, k + 0.0009, side)
                    if side == 'bid' and not (r[3] is not None and r[3] <= limit): continue
                    if side == 'ask' and not (r[2] is not None and r[2] >= limit): continue
                    px = (r[3] if side == 'bid' else r[2]) * TICK          # the IOC takes the resting price
                    qty = math.floor(GBP_RUNG / px * 1e5) / 1e5
                    fee = math.ceil(qty * px * FEE * 100 - 1e-9) / 100      # the venue's fee, a whole penny up
                    ex = exit_sim(b, side, int(at), px, qty, fill)
                    if not ex: continue
                    te, xpx, how, pnl = ex
                    pnl -= fee
                    if how == 'stop': pnl -= math.ceil(qty * xpx * FEE * 100 - 1e-9) / 100 - qty * xpx * FEE
                    displaced = [p for a, z_, p in HELD[key] if at <= a < te + M]   # LIVE's trips it would have blocked
                    out.append({'book': b, 'side': side, 'k': k, 'at': iso(int(at)), 'day': day(int(at)), 'limit': limit * TICK, 'px': px, 'fair': f,
                                'edgeBps': round(1e4 * ((f - px) / f if side == 'bid' else (px - f) / f), 1), 'feeGbp': fee, 'exit': iso(te), 'how': how,
                                'pnlGbp': round(pnl, 4), 'displacedTrips': len(displaced), 'displacedGbp': round(sum(displaced), 4),
                                'netGbp': round(pnl - sum(displaced), 4)})
                    holding[key] = te + M
    return out

def weekdays(a, b):
    o, t = [], a - a % DAY
    while t < b:
        if datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).weekday() < 5: o.append(day(t))
        t += DAY
    return o
def boot(xs):
    rng = random.Random(SEED); n = len(xs); m = []
    for _ in range(10000): m.append(sum(xs[rng.randrange(n)] for _ in range(n)) / n)
    m.sort()
    return {'days': n, 'mean': round(sum(xs) / n, 4), 'p05': round(m[500], 4), 'p95': round(m[9499], 4), 'shareAtOrBelow0': round(sum(1 for v in m if v <= 0) / 10000, 4)}

res = {'takeFrom': iso(TAKE_FROM), 'end': iso(END), 'gbpRung': GBP_RUNG}
for fill in ('through', 'at'):
    tk = takes(fill)
    days = weekdays(TAKE_FROM + DAY - TAKE_FROM % DAY, END)
    per = collections.Counter()
    for x in tk: per[x['day']] += x['netGbp']
    res[f'take_{fill}'] = {'n': len(tk), 'won': sum(1 for x in tk if x['pnlGbp'] > 0), 'stops': sum(1 for x in tk if x['how'] == 'stop'),
                           'pnlGbp': round(sum(x['pnlGbp'] for x in tk), 4), 'feesGbp': round(sum(x['feeGbp'] for x in tk), 4),
                           'displacedGbp': round(sum(x['displacedGbp'] for x in tk), 4), 'netGbp': round(sum(x['netGbp'] for x in tk), 4),
                           'perWeekday': boot([per.get(d, 0.0) for d in days]), 'list': tk}
    print(fill, {k: v for k, v in res[f'take_{fill}'].items() if k != 'list'})

# ---- (ii) the weekend at LIVE's size on PR5's record, and the replay's weekdays beside LIVE's own
F0, F1 = 1790380800000, 1792281600000
alldays = [day(t) for t in range(F0, F1, DAY)]
for fill in ('through', 'at'):
    base, _ = RP.run(mins, prints, fill=fill, t_to=F1, size_usd=GBP_RUNG * 1.33)
    wk, _ = RP.run(mins, prints, fill=fill, t_to=F1, size_usd=GBP_RUNG * 1.33, xhold=True)
    dl = lambda tr: [sum(t['pnlGbp'] for t in tr if F0 <= t['tEntry'] < F1 and day(t['tEntry']) == d) for d in alldays]
    db, dw = dl(base), dl(wk)
    res[f'weekend_{fill}'] = {'days': len(alldays), 'baseGbp': round(sum(db), 4), 'weekendGbp': round(sum(dw), 4), 'diff': boot([a - b for a, b in zip(dw, db)]),
                              'byWeekendDay': {d: round(a - b, 4) for d, a, b in zip(alldays, dw, db) if datetime.date.fromisoformat(d).weekday() >= 5 or abs(a - b) > 1e-9}}
    # LIVE's own weekdays since its first whole one (10-02) against the replay's at its size, by entry day
    lv = collections.Counter()
    for t in LIVE: lv[t['tEntry'][:10]] += t['pnlGbp']
    wd = weekdays(1791158400000, END)                    # 2026-10-02 -> 10-16
    rep = {d: v for d, v in zip(alldays, db)}
    res[f'calibration_{fill}'] = {'weekdays': len(wd), 'liveGbp': round(sum(lv.get(d, 0.0) for d in wd), 4), 'replayGbp': round(sum(rep.get(d, 0.0) for d in wd), 4),
                                  'byDay': {d: [round(lv.get(d, 0.0), 4), round(rep.get(d, 0.0), 4)] for d in wd}}
    print(fill, 'weekend', {k: v for k, v in res[f'weekend_{fill}'].items() if k != 'byWeekendDay'}, 'calibration', res[f'calibration_{fill}']['liveGbp'], res[f'calibration_{fill}']['replayGbp'])
json.dump(res, open(os.path.join(HERE, 'results', 'results.json'), 'w'), indent=1)
