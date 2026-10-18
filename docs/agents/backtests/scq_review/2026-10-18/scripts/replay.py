# 2026-10-18 stablecoin quotes review: PR5's rule replayed on its own stored record, with one thing changed at a time.
#
# `step` below is `stepMinute` of supabase/functions/agents/quotes.ts, line for line (the turn at the start of minute t
# on data to t-1, an order live from t+1, the post-only refusal against the last print before it goes live, fills on
# prints strictly through, at most $100 or 10 % of the minute's printed GBP times X, exits at fair, the 0.05 % re-price,
# the 24-hour stop at the minute's last print as a taker at 0.09 % + 0.0067 %), with these knobs, each at PR5's value by
# default:
#   rungs        the k of each entry rung (both sides)          [0.001, 0.002, 0.003]
#   size_usd     one rung's size in USD                        100
#   vol_share    the share of the minute's printed volume      0.10
#   stop_ms      the stop's age                                86,400,000 (None: no stop)
#   reprice      the re-price step                             0.0005
#   exit_off     exit offset in ticks beyond fair              0
#   fill         'through' (PR5) or 'at' (a print AT the price, its aggressor on the other side, fills too)
#   gate(t)      False: no entry quote in minute t (a resting entry is withdrawn, as when dark); exits untouched
#   xhold        True: inside an FX closure (Fri 21:00 -> Sun 21:00 UTC) a dark minute takes the last live X (PR5-W's rule)
#   max_side     at most this many open positions per book and side (None: no limit); further entries of that side wait
#   books        which books quote
# Inputs: data/minutes.txt.gz, data/prints.txt.gz (sql/pull_replay.sql, gzip -n -9). The baseline must reproduce PR5's paper trips
# (data/paper_trips.txt.gz) from the first whole day of the record; `python3 -I scripts/replay.py check` says how closely.
import math, os, sys, json, bisect, datetime, collections, gzip

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
M, H, DAY = 60_000, 3_600_000, 86_400_000
TICK, FEE, HALF = 1e-4, 0.0009, 0.000067
BOOKS = ['USDC-GBP', 'USDT-GBP']


def _lines(name):
    """data/<name>.txt, or the committed data/<name>.txt.gz."""
    p = os.path.join(HERE, 'data', name + '.txt')
    return open(p) if os.path.exists(p) else gzip.open(p + '.gz', 'rt')


def load():
    mins = collections.defaultdict(list)
    for l in _lines('minutes'):
        l = l.strip()
        if not l: continue
        b, ms, x, fu, pn = l.split('|')
        mins[b].append((int(ms), float(x) if x else None, float(fu) if fu else None))
    prints = collections.defaultdict(list)
    for l in _lines('prints'):
        l = l.strip()
        if not l: continue
        pid, b, ms, px, q, sd = l.split('|')
        prints[b].append((int(ms), round(float(px) / TICK), float(q), sd, pid))
    for b in prints: prints[b].sort(key=lambda p: (p[0], p[4]))
    return mins, prints


def closure(t):
    """Inside the weekly FX closure, Friday 21:00 -> Sunday 21:00 UTC (PR5-W's case 2 window)."""
    d = datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc)
    wd, hh = d.weekday(), d.hour
    return (wd == 4 and hh >= 21) or wd == 5 or (wd == 6 and hh < 21)


def qt(f, k, side):
    return math.floor(f * (1 - k) / TICK + 1e-9) if side == 'bid' else math.ceil(f * (1 + k) / TICK - 1e-9)


def et(f, pos_side, off=0):
    return (math.ceil(f / TICK - 1e-9) + off) if pos_side == 'bid' else (math.floor(f / TICK + 1e-9) - off)


def blocks(side, ticks, lp):
    if lp is None: return False
    return lp[1] < ticks or (lp[1] == ticks and lp[3] == 'buy') if side == 'bid' else lp[1] > ticks or (lp[1] == ticks and lp[3] == 'sell')


def fills(o, p, mode):
    if o['side'] == 'bid':
        return p[1] < o['ticks'] or (mode == 'at' and p[1] == o['ticks'] and p[3] == 'sell')
    return p[1] > o['ticks'] or (mode == 'at' and p[1] == o['ticks'] and p[3] == 'buy')


def run(mins, prints, rungs=(0.001, 0.002, 0.003), size_usd=100.0, vol_share=0.10, stop_ms=DAY, reprice=0.0005, exit_off=0,
        fill='through', gate=None, xhold=False, max_side=None, books=BOOKS, t_from=None, t_to=None):
    trips, orders = [], collections.Counter()
    for b in books:
        R = [{'side': s, 'k': k, 'mode': 'idle', 'o': None} for s in ('bid', 'ask') for k in rungs]
        lastX, lastLiveX, lp = None, None, None
        P = prints[b]; pi = 0
        for (t, x0, fu) in mins[b]:
            if t_from is not None and t < t_from:
                while pi < len(P) and P[pi][0] < t + M: lp = P[pi]; pi += 1
                if x0: lastLiveX = x0
                continue
            if t_to is not None and t >= t_to: break
            x = x0
            if x: lastLiveX = x
            elif xhold and closure(t) and lastLiveX: x = lastLiveX
            if x: lastX = x
            f = fu / x if (x and fu) else None
            allow = gate is None or gate(t, b)
            lpb = lp
            day = t // DAY
            held = collections.Counter(r['side'] for r in R if r['mode'] == 'position')

            def new(side, ticks, fa):
                return {'side': side, 'ticks': ticks, 'fairAt': fa, 'live': t + M, 'state': 'pending'}
            for r in R:
                if r['mode'] in ('idle', 'quote'):
                    o = r['o']
                    capped = max_side is not None and held[r['side']] >= max_side
                    if f is None or not allow or capped:
                        if r['mode'] == 'quote': r['mode'], r['o'] = 'idle', None
                        continue
                    if r['mode'] == 'idle' or o is None:
                        r['o'] = new(r['side'], qt(f, r['k'], r['side']), f); r['mode'] = 'quote'; orders[day] += 1
                        continue
                    if o['state'] == 'rejected':
                        if abs(f / o['fairAt'] - 1) > reprice: o['ticks'] = qt(f, r['k'], r['side']); o['fairAt'] = f
                        if not blocks(o['side'], o['ticks'], lpb): o['live'] = t + M; o['state'] = 'pending'; orders[day] += 1
                        continue
                    if abs(f / o['fairAt'] - 1) > reprice:
                        o['ticks'] = qt(f, r['k'], r['side']); o['fairAt'] = f; o['live'] = t + M; o['state'] = 'pending'; orders[day] += 1
                else:
                    o = r['o']; xs = 'ask' if r['side'] == 'bid' else 'bid'
                    if o is None:
                        if f is not None: r['o'] = new(xs, et(f, r['side'], exit_off), f); orders[day] += 1
                    elif o['state'] == 'rejected':
                        if f is not None and abs(f / o['fairAt'] - 1) > reprice: o['ticks'] = et(f, r['side'], exit_off); o['fairAt'] = f
                        if not blocks(o['side'], o['ticks'], lpb): o['live'] = t + M; o['state'] = 'pending'; orders[day] += 1
                    elif f is not None and abs(f / o['fairAt'] - 1) > reprice:
                        o['ticks'] = et(f, r['side'], exit_off); o['fairAt'] = f; o['live'] = t + M; o['state'] = 'pending'; orders[day] += 1
            for r in R:
                o = r['o']
                if o and o['state'] == 'pending' and o['live'] == t:
                    o['state'] = 'rejected' if blocks(o['side'], o['ticks'], lpb) else 'live'
            mp = []
            while pi < len(P) and P[pi][0] < t + M:
                if P[pi][0] >= t: mp.append(P[pi])
                pi += 1
            if mp:
                qvol = sum(p[2] * p[1] * TICK for p in mp)
                for p in mp:
                    for r in R:
                        o = r['o']
                        if not o or o['state'] != 'live' or not fills(o, p, fill): continue
                        if r['mode'] == 'quote':
                            if not lastX: continue
                            usd = min(size_usd, vol_share * qvol * lastX)
                            if usd <= 0: continue
                            nq, px = usd / lastX, o['ticks'] * TICK
                            r.update(mode='position', o=None, entry=px, tEntry=t, qty=nq / px, nq=nq, fair=f, fillTs=p[0])
                        elif r['mode'] == 'position':
                            _close(trips, b, r, t, o['ticks'] * TICK, 'maker', lastX)
                lp = mp[-1]
            for r in R:
                if r['mode'] == 'position' and stop_ms is not None and r['tEntry'] != t and t >= r['tEntry'] + stop_ms and lp:
                    c = lp[1] * TICK
                    px = c * (1 - FEE - HALF) if r['side'] == 'bid' else c * (1 + FEE + HALF)
                    _close(trips, b, r, t, px, 'taker', lastX)
        for r in R:   # still open at the end: marked at the last print, flagged
            if r['mode'] == 'position' and lp:
                _close(trips, b, r, t_to or mins[b][-1][0], lp[1] * TICK, 'open', lastX)
    return trips, orders


def _close(trips, b, r, t, px, how, lastX):
    pnl_gbp = r['qty'] * (px - r['entry']) if r['side'] == 'bid' else r['qty'] * (r['entry'] - px)
    trips.append({'book': b, 'side': r['side'], 'k': r['k'], 'tEntry': r['tEntry'], 'tExit': t, 'entry': r['entry'], 'exit': px,
                  'how': how, 'qty': r['qty'], 'gbp': r['qty'] * r['entry'], 'pnlGbp': pnl_gbp, 'pnlUsd': pnl_gbp * (lastX or 1.0),
                  'fairEntry': r['fair'], 'fillTs': r['fillTs']})
    r.update(mode='idle', o=None)


def check():
    """The baseline against PR5's paper trips: trips entered from 2026-09-26 00:00 (a whole day after the record's start)."""
    mins, prints = load()
    trips, _ = run(mins, prints)
    T0 = 1790380800000  # 2026-09-26 00:00 UTC
    T1 = 1792195200000  # 2026-10-17 00:00 UTC (trips that could have closed by the pull)
    ours = {(t['book'], t['side'], round(t['k'], 4), t['tEntry']): t for t in trips if T0 <= t['tEntry'] < T1 and t['how'] != 'open'}
    theirs = {}
    for l in _lines('paper_trips'):
        l = l.strip()
        if not l: continue
        b, s, k, te, tx, en, ex, how, nt, pnl = l.split('|')
        if T0 <= int(te) < T1: theirs[(b, s, round(float(k), 4), int(te))] = {'tExit': int(tx), 'pnlUsd': float(pnl), 'how': how}
    both = set(ours) & set(theirs)
    same_exit = sum(1 for k in both if ours[k]['tExit'] == theirs[k]['tExit'])
    out = {'from': '2026-09-26', 'to': '2026-10-17', 'paperTrips': len(theirs), 'replayTrips': len(ours), 'matched': len(both), 'sameExit': same_exit,
           'paperPnlUsd': round(sum(v['pnlUsd'] for v in theirs.values()), 4), 'replayPnlUsd': round(sum(v['pnlUsd'] for v in ours.values()), 4),
           'matchedPnlUsd_paper': round(sum(theirs[k]['pnlUsd'] for k in both), 4), 'matchedPnlUsd_replay': round(sum(ours[k]['pnlUsd'] for k in both), 4),
           'onlyPaper': sorted([list(k) for k in set(theirs) - set(ours)])[:20], 'onlyReplay': sorted([list(k) for k in set(ours) - set(theirs)])[:20]}
    return out


if __name__ == '__main__' and len(sys.argv) > 1 and sys.argv[1] == 'check':
    r = check()
    json.dump(r, open(os.path.join(HERE, 'results', 'replay_check.json'), 'w'), indent=1)
    print(json.dumps(r, indent=1))
