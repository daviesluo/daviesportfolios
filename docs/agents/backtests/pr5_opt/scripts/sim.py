# PR5-OPT (2026-10-27): LIVE's rules replayed with one change at a time, LIVE-realistic.
#
# Two layers, as production has them:
#   PAPER  PR5's paper engine, `stepMinute` (agents/quotes.ts) line for line, as the 2026-10-18 review's replay.py has it:
#          the turn at the start of minute t on data to t-1, orders live from t+1, the post-only refusal, fills only on prints
#          strictly through, $100 a rung and at most 10 % of the minute's printed GBP x X, exits at fair, the 0.05 % re-price,
#          the 24-hour stop. With `xhold` a dark minute inside the FX closure (Fri 21:00 -> Sun 21:00 UTC) takes the last
#          live X (PR5-W's rule, the weekend replica LIVE quotes from since 2026-10-23 21:00).
#   LIVE   the live executor (agents/quotes_live.ts) as the LIVE twin simulates it (agents/revx_sim.ts with `fill` "at"):
#          one turn a minute, OFF seconds into the minute after the paper minute it carries out; a flat rung rests the paper
#          rung's entry order (same ticks) while the paper rung quotes, nothing while it does not; a resting order fills on a
#          public print through its price OR at it with the aggressor on the other side, by the print's own quantity, the
#          orders it reaches sharing it best price first; a filled (even partly) rung is held: its entry's rest is
#          withdrawn at the next turn and an exit for the whole holding rests at the rule's exit (fair, rounded in the
#          position's favour), re-priced when fair moves more than the exit step; the 24-hour stop from the first fill closes
#          at the last print as a taker (0.09 % + half the measured spread); de-peg guard: no entry while the book's last
#          print is more than 50 bps from fair. A rung is flat again when it holds under 0.135 coin (the 2026-10-26 review's
#          dust); the remnant is marked at the last fill price into its trip, as that review's cash-flow check does.
# Left out (each disclosed in the review): the USD-book half of the de-peg guard (hourly closes are not in the minute record),
# the governor (LIVE sends about 283 POSTs a day against 900), the daily loss stop (checked after the fact: no replayed day
# comes near -1 %), the asks' coin inventory (assumed always there: the executor tops it up), cancels' read-back lag,
# venue outages and the dead-man.
#
# Knobs (each at LIVE's value by default) are listed in DEFAULTS. Every size is in GBP a rung.
import math, os, sys, json, bisect, datetime, collections, gzip

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
M, H, DAY = 60_000, 3_600_000, 86_400_000
TICK, FEE, HALF = 1e-4, 0.0009, 0.000067
BOOKS = ['USDC-GBP', 'USDT-GBP']
DUST = 0.135          # the 2026-10-26 review's cash-flow dust (LIVE's record); the executor's own is £0.10 of coin
MIN_GBP = 0.10        # the venue's minimum order (min_order_size_quote): at or under it a rung holds nothing (`dustBase`)

DEFAULTS = dict(
    rungs=(0.001, 0.002, 0.003),   # the paper engine's rungs (both sides, both books): a change here is a new engine
    rungs_bb=None,                 # {(book, side): rungs} in place of `rungs` (per-book or asymmetric distances)
    kmul=None,                     # kmul(t, book) -> a factor on every rung's distance at the paper turn t (e.g. weekends wider)
    size=None,                     # {(book, side, k): GBP} or a callable; None: equal_size(capital)
    capital=600.0,                 # GBP, split equally when `size` is None
    retired=(),                    # (book, side, k) the executor does not quote (its paper decisions not carried out)
    reprice=0.0005,                # the paper engine's re-price step (entries and paper exits)
    exit_reprice=None,             # the executor's exit re-price step (None: = reprice)
    exit_off=0,                    # exit ticks beyond fair in the position's favour (negative: inside fair)
    exit_after=None,               # (hours, ticks): from this age the exit moves `ticks` toward the market (inside fair)
    stop_ms=DAY,                   # the executor's stop age (None: none)
    gate=None,                     # gate(ms, book) -> False: no entry at this turn (executor side)
    depeg=0.005,                   # the executor's GBP-print de-peg guard
    xhold=True,                    # weekend quoting on the held X
    xhold_from=None,               # ms: weekend rule only from here (LIVE: 2026-10-23 21:00)
    fill='at',                     # 'at' (LIVE's own fill rule) or 'through'
    at_share=1.0,                  # share of an AT-price print's quantity our orders may take (queue sensitivity)
    off_s=30,                      # executor turn, seconds into the minute
    skew=None,                     # (bps, units): shift the book's entries away from the side it holds, per held rung
    fair_adj=None,                 # callable(book, t, f) -> f' (executor and paper use it)
    hold_min_gbp=MIN_GBP,          # a fill makes the rung held (entry withdrawn, exit rests) once it holds more than this
    paper_size_usd=100.0, paper_vol_share=0.10,
)


def _lines(path):
    return gzip.open(path, 'rt') if path.endswith('.gz') else open(path)


def load_fwd(data=os.path.join(HERE, 'data')):
    """PR5's own stored record: every minute's X and fairU (agent_quote_minutes) and every stored UK print."""
    mins = collections.defaultdict(list)
    for part in ('minutes_a', 'minutes_b', 'minutes_c'):
        p = os.path.join(data, part + '.txt')
        for l in _lines(p if os.path.exists(p) else p + '.gz'):
            l = l.strip()
            if not l: continue
            b, ms, x, fu, pn = l.split('|')
            mins[b].append((int(ms), float(x) if x else None, float(fu) if fu else None))
    for b in mins: mins[b].sort()
    prints = collections.defaultdict(list)
    p = os.path.join(data, 'prints.txt')
    for l in _lines(p if os.path.exists(p) else p + '.gz'):
        l = l.strip()
        if not l: continue
        pid, b, ms, px, q, sd = l.split('|')
        prints[b].append((int(ms), round(float(px) / TICK), float(q), sd, pid))
    for b in prints: prints[b].sort(key=lambda z: (z[0], z[4]))
    return mins, prints


def load_hist(t0, t1):
    """The committed nine-month tape (docs/agents/backtests/inputs/pr5_2026-09-23) through pr5_sim.py's own loaders."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('pr5_sim', os.path.join(REPO, 'docs', 'agents', 'scripts', 'pr5', 'pr5_sim.py'))
    S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)
    fx = S.fx_series()
    mins, prints = {}, {}
    for b in BOOKS:
        a = max(t0, S.START[b])
        bk = S.Book(b, a, t1, fx)
        fu = S.fair_usd_minutes(S.USD_OF[b], a, t1)
        mins[b] = [(a + i * M, bk.X[i], fu.get(a + i * M)) for i in range(bk.n)]
        prints[b] = [(ts, pt, q, sd, f'{ts}-{j}') for j, (ts, pt, q, sd) in enumerate(bk.all_prints)]
    return mins, prints


def closure(t):
    d = datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc)
    wd, hh = d.weekday(), d.hour
    return (wd == 4 and hh >= 21) or wd == 5 or (wd == 6 and hh < 21)


def qt(f, k, side):
    return math.floor(f * (1 - k) / TICK + 1e-9) if side == 'bid' else math.ceil(f * (1 + k) / TICK - 1e-9)


def et(f, pos_side, off=0):
    return (math.ceil(f / TICK - 1e-9) + off) if pos_side == 'bid' else (math.floor(f / TICK + 1e-9) - off)


def blocks(side, ticks, lp):
    """side: the ORDER's book side ('bid' buys, 'ask' sells); lp = (ticks, aggressor)."""
    if lp is None: return False
    return lp[0] < ticks or (lp[0] == ticks and lp[1] == 'buy') if side == 'bid' else lp[0] > ticks or (lp[0] == ticks and lp[1] == 'sell')


def through(side, ticks, pt):
    return pt < ticks if side == 'bid' else pt > ticks


def at_fill(side, ticks, pt, aggr):
    return pt == ticks and ((side == 'bid' and aggr == 'sell') or (side == 'ask' and aggr == 'buy'))


def equal_size(capital, rungs, books=BOOKS):
    n = len(books) * 2 * len(rungs)
    return {(b, s, k): capital / n for b in books for s in ('bid', 'ask') for k in rungs}


class Paper:
    """stepMinute for one book, with the rule's knobs (rungs, re-price, xhold, fair adjustment)."""

    def __init__(self, book, cfg):
        self.b, self.c = book, cfg
        rb = cfg['rungs_bb'] or {}
        self.R = [{'side': s, 'k': k, 'mode': 'idle', 'o': None} for s in ('bid', 'ask') for k in rb.get((book, s), cfg['rungs'])]
        self.lastX = self.lastLiveX = None
        self.lp = None          # last print (ticks, aggr)
        self.f = None           # fair of the last decided minute
        self.orders = 0
        self.closed = []        # the paper's own round trips: (book, side, k, entry minute, exit minute, how)

    def step(self, t, x0, fu, mp):
        c = self.c
        x = x0
        if x: self.lastLiveX = x
        elif c['xhold'] and closure(t) and self.lastLiveX and (c['xhold_from'] is None or t >= c['xhold_from']): x = self.lastLiveX
        if x: self.lastX = x
        f = fu / x if (x and fu) else None
        if f is not None and c['fair_adj']: f = c['fair_adj'](self.b, t, f)
        self.f = f
        lpb = self.lp
        rp = c['reprice']
        km = c['kmul'](t, self.b) if c['kmul'] else 1.0
        qt_ = lambda f_, k_, s_: qt(f_, k_ * km, s_)

        def new(side, ticks, fa):
            self.orders += 1
            return {'side': side, 'ticks': ticks, 'fairAt': fa, 'live': t + M, 'state': 'pending'}
        for r in self.R:
            if r['mode'] in ('idle', 'quote'):
                o = r['o']
                if f is None:
                    if r['mode'] == 'quote': r['mode'], r['o'] = 'idle', None
                    continue
                if r['mode'] == 'idle' or o is None:
                    r['o'] = new(r['side'], qt_(f, r['k'], r['side']), f); r['mode'] = 'quote'
                    continue
                if o['state'] == 'rejected':
                    if abs(f / o['fairAt'] - 1) > rp: o['ticks'] = qt_(f, r['k'], r['side']); o['fairAt'] = f
                    if not blocks(o['side'], o['ticks'], lpb): o['live'] = t + M; o['state'] = 'pending'; self.orders += 1
                    continue
                if abs(f / o['fairAt'] - 1) > rp:
                    o['ticks'] = qt_(f, r['k'], r['side']); o['fairAt'] = f; o['live'] = t + M; o['state'] = 'pending'; self.orders += 1
            else:
                o = r['o']; xs = 'ask' if r['side'] == 'bid' else 'bid'
                if o is None:
                    if f is not None: r['o'] = new(xs, et(f, r['side']), f)
                elif o['state'] == 'rejected':
                    if f is not None and abs(f / o['fairAt'] - 1) > rp: o['ticks'] = et(f, r['side']); o['fairAt'] = f
                    if not blocks(o['side'], o['ticks'], lpb): o['live'] = t + M; o['state'] = 'pending'; self.orders += 1
                elif f is not None and abs(f / o['fairAt'] - 1) > rp:
                    o['ticks'] = et(f, r['side']); o['fairAt'] = f; o['live'] = t + M; o['state'] = 'pending'; self.orders += 1
        for r in self.R:
            o = r['o']
            if o and o['state'] == 'pending' and o['live'] == t:
                o['state'] = 'rejected' if blocks(o['side'], o['ticks'], lpb) else 'live'
        if mp:
            qvol = sum(p[2] * p[1] * TICK for p in mp)
            for p in mp:
                for r in self.R:
                    o = r['o']
                    if not o or o['state'] != 'live' or not through(o['side'], o['ticks'], p[1]): continue
                    if r['mode'] == 'quote':
                        if not self.lastX: continue
                        usd = min(c['paper_size_usd'], c['paper_vol_share'] * qvol * self.lastX)
                        if usd <= 0: continue
                        r.update(mode='position', o=None, tEntry=t)
                    elif r['mode'] == 'position':
                        r.update(mode='idle', o=None)
                        self.closed.append((self.b, r['side'], r['k'], r['tEntry'], t, 'maker'))
            self.lp = (mp[-1][1], mp[-1][3])
        for r in self.R:
            if r['mode'] == 'position' and r['tEntry'] != t and t >= r['tEntry'] + DAY and self.lp:
                r.update(mode='idle', o=None)
                self.closed.append((self.b, r['side'], r['k'], r['tEntry'], t, 'taker'))


def run(mins, prints, t_from, t_to, marks=None, papers=None, **kw):
    """One configuration over [t_from, t_to): the executor's round trips (GBP) and its daily realised (by exit day)."""
    c = dict(DEFAULTS); c.update(kw)
    if c['exit_reprice'] is None: c['exit_reprice'] = c['reprice']
    if c['size'] is not None: size = c['size']
    elif c['rungs_bb']:
        keys = [(b_, s_, k_) for b_ in BOOKS for s_ in ('bid', 'ask') for k_ in c['rungs_bb'].get((b_, s_), c['rungs'])]
        size = {key: c['capital'] / len(keys) for key in keys}
    else: size = equal_size(c['capital'], c['rungs'])
    retired = set(c['retired'])
    off = c['off_s'] * 1000
    trips = []
    for b in BOOKS:
        if b not in mins: continue
        pap = Paper(b, c)
        if papers is not None: papers[b] = pap
        L = {(r['side'], r['k']): {'side': r['side'], 'k': r['k'], 'held': 0.0, 'cash': 0.0, 'opened': None, 'gbp': 0.0, 'inpos': False,
                                   'entry': None, 'exit': None, 'exitAge': 0} for r in pap.R}
        P = prints[b]; pi = 0
        lastp = None           # last print (ticks, aggr) seen by the executor
        lastpx = None

        def live_orders():
            out = []
            for r in L.values():
                if r['entry'] is not None: out.append((r, r['entry'], 'entry'))
                if r['exit'] is not None: out.append((r, r['exit'], 'exit'))
            return out

        def apply_print(p):
            nonlocal lastp, lastpx
            ts, pt, q, aggr = p[0], p[1], p[2], p[3]
            cand = []
            for r, o, leg in live_orders():
                if o['live'] > ts or o['qty'] <= 1e-12: continue
                if through(o['side'], o['ticks'], pt): share = 1.0
                elif c['fill'] == 'at' and at_fill(o['side'], o['ticks'], pt, aggr): share = c['at_share']
                else: continue
                cand.append((r, o, leg, share))
            if cand:
                # best price first: bids high first, asks low first (a print fills one side only)
                cand.sort(key=lambda z: (-z[1]['ticks'] if z[1]['side'] == 'bid' else z[1]['ticks'], z[1]['live']))
                used = used_at = 0.0
                for r, o, leg, share in cand:
                    avail = (q - used) if share == 1.0 else min(q - used, q * share - used_at)
                    if avail <= 1e-12: continue
                    take = min(o['qty'], avail)
                    used += take
                    if share != 1.0: used_at += take
                    o['qty'] -= take
                    px = o['ticks'] * TICK
                    sgn = 1 if o['side'] == 'bid' else -1     # buy +coin
                    pos_sgn = 1 if r['side'] == 'bid' else -1
                    if leg == 'entry':
                        was = r['held']
                        r['held'] += take; r['cash'] -= sgn * take * px; r['gbp'] += take * px
                        if not r['inpos'] and r['held'] * px > c['hold_min_gbp'] + 1e-9:
                            r['inpos'] = True; r['opened'] = ts
                    else:
                        r['held'] -= take; r['cash'] -= sgn * take * px
                        if r['exit'] is not None: r['exit']['qty'] = max(0.0, min(r['exit']['qty'], r['held']))
                        if r['held'] * px <= MIN_GBP + 1e-9:
                            pnl = r['cash'] + pos_sgn * r['held'] * px
                            trips.append({'book': b, 'side': r['side'], 'k': r['k'], 'tEntry': r['opened'], 'tExit': ts, 'pnl': pnl,
                                          'gbp': r['gbp'], 'how': 'maker'})
                            r.update(held=0.0, cash=0.0, opened=None, gbp=0.0, exit=None, entry=None, inpos=False)
            lastp = (pt, aggr); lastpx = pt * TICK

        def turn(T):
            f = pap.f
            # the book's net holding in rungs, for the skew
            net = 0
            if c['skew']:
                net = sum((1 if r['side'] == 'bid' else -1) for r in L.values() if r['inpos'])
            pr = {(r['side'], r['k']): r for r in pap.R}
            for key, r in L.items():
                if r['inpos']:
                    r['entry'] = None
                    if c['stop_ms'] is not None and T - r['opened'] >= c['stop_ms'] and lastpx:
                        px = lastpx * (1 - FEE - HALF) if r['side'] == 'bid' else lastpx * (1 + FEE + HALF)
                        pos_sgn = 1 if r['side'] == 'bid' else -1
                        pnl = r['cash'] + pos_sgn * r['held'] * px
                        trips.append({'book': b, 'side': r['side'], 'k': r['k'], 'tEntry': r['opened'], 'tExit': T, 'pnl': pnl, 'gbp': r['gbp'], 'how': 'taker'})
                        r.update(held=0.0, cash=0.0, opened=None, gbp=0.0, exit=None, inpos=False)
                        continue
                    if f is None: continue
                    xs = 'ask' if r['side'] == 'bid' else 'bid'
                    offt = c['exit_off']
                    if c['exit_after'] and T - r['opened'] >= c['exit_after'][0] * H: offt = offt - c['exit_after'][1]
                    want = et(f, r['side'], offt)
                    o = r['exit']
                    if o is None or o.get('off') != offt or abs(f / o['fair'] - 1) > c['exit_reprice']:
                        if o is not None and o['ticks'] == want and o.get('off') == offt:
                            o['fair'] = f
                            continue
                        if blocks(xs, want, lastp):
                            r['exit'] = None          # refused; tried again next turn
                            continue
                        r['exit'] = {'side': xs, 'ticks': want, 'qty': r['held'], 'live': T, 'fair': f, 'off': offt}
                    continue
                r['exit'] = None
                p = pr[key]
                tgt = None
                if p['mode'] == 'quote' and p['o'] is not None and p['o']['state'] != 'rejected' and f is not None:
                    tgt = p['o']['ticks']
                if tgt is not None and (b, r['side'], r['k']) in retired: tgt = None
                if tgt is not None and c['gate'] is not None and not c['gate'](T, b, r['side'], r['k']): tgt = None
                if tgt is not None and lastpx is not None and abs(lastpx / f - 1) > c['depeg']: tgt = None
                gbp = size.get((b, r['side'], r['k']), 0.0) if isinstance(size, dict) else size(b, r['side'], r['k'])
                if tgt is not None and gbp < 0.1: tgt = None
                if tgt is not None and c['skew'] and net:
                    bps, cap_units = c['skew']
                    units = max(-cap_units, min(cap_units, net))
                    # long coin (bids held): both sides' entries move down (bids further, asks closer); short: up
                    shift = round(units * bps * 1e-4 * f / TICK)
                    tgt = tgt - shift
                    if r['side'] == 'ask' and tgt <= et(f, 'bid'): tgt = et(f, 'bid') + 1
                    if r['side'] == 'bid' and tgt >= et(f, 'ask'): tgt = et(f, 'ask') - 1
                if tgt is None:
                    r['entry'] = None
                    continue
                e = r['entry']
                if e is not None and e['ticks'] == tgt: continue
                if blocks(r['side'], tgt, lastp):
                    r['entry'] = None
                    continue
                r['entry'] = {'side': r['side'], 'ticks': tgt, 'qty': gbp / (tgt * TICK), 'live': T}

        mins_b = mins[b]
        for (t, x0, fu) in mins_b:
            if t >= t_to: break
            if marks is not None and t % DAY == 0 and t >= t_from and lastpx:
                # the rungs' holdings marked at the last print at each UTC midnight (the asks' coin inventory is not a rung's)
                u = sum(r['cash'] + (1 if r['side'] == 'bid' else -1) * r['held'] * lastpx for r in L.values() if r['held'] > 0)
                marks[t] = marks.get(t, 0.0) + u
            mp = []
            while pi < len(P) and P[pi][0] < t + M:
                if P[pi][0] >= t: mp.append(P[pi])
                elif t < t_from: pass
                pi += 1
            if t >= t_from:
                T = t + off
                for p in mp:
                    if p[0] < T: apply_print(p)
                turn(T)
                for p in mp:
                    if p[0] >= T: apply_print(p)
            else:
                if mp: lastp = (mp[-1][1], mp[-1][3]); lastpx = mp[-1][1] * TICK
            pap.step(t, x0, fu, mp)
        for r in L.values():   # still held at the end: marked at the last print
            if r['held'] * (lastpx or 0) > MIN_GBP and lastpx:
                pos_sgn = 1 if r['side'] == 'bid' else -1
                trips.append({'book': b, 'side': r['side'], 'k': r['k'], 'tEntry': r['opened'], 'tExit': t_to, 'pnl': r['cash'] + pos_sgn * r['held'] * lastpx,
                              'gbp': r['gbp'], 'how': 'open'})
    cap = sum(size.values()) if isinstance(size, dict) else c['capital']
    return trips, cap
