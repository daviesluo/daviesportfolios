# LP-BEST: the portfolio engine. One minute at a time over every market a policy holds or quotes, with one pot of
# capital, the fill rule and the reward formula of lib.py, and the calibration of calib.py (k_vol, R). Every strategy in
# the study, and the replay of live-prep's own rule that validates the engine, is a Policy run through `run`.
#
# A minute t, for each market active that minute, in the day's rank order:
#   1. state: the market's position (net YES, cost), its mark (raw mid), pauses, its loss guard, the programme in force;
#   2. quotes: the policy's entry prices (placement) and exits (exit placement), sizes, the inventory cap, the filters;
#   3. capital: a buy rests only while everything held at cost plus the resting buys stays inside the cap (and the
#      per-market cap), funded in rank order; sells need no cash (a SELL of what is held, or in YES terms the side that
#      reduces the position);
#   4. reward: what rests scores the minute's formula (two-sided part x R2, the one-sided third x R1);
#   5. fills: the minute's prints against what rests (price-time priority from the book we posted into, the print's
#      average price must reach ours; x k_vol, the live/simulator volume ratio), then cash, position and cost move.
# A quote is decided on minute t's book and rests from about t+7 s to t+67 s (the tape's clock, t+10 s to t+70 s).
import os, sys, math, json, collections
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
from lib import Market

CAL = {}
def calib():
    global CAL
    if not CAL:
        CAL = json.load(open(os.path.join(lib.WORK, 'calib.json')))
        vp = os.path.join(lib.WORK, 'validate.json')
        if os.path.exists(vp) and os.environ.get('LPBEST_RAW_R') != '1': CAL['R_engine'] = json.load(open(vp))['R_engine']
    return CAL

DEFAULT = dict(
    name='live-prep as run',
    place='inside', k=0, dist=None,      # entry placement (lib.Market.placed)
    exit_place='inside', exit_k=0,       # where a position's reducing side rests
    size_mult=1.0,                       # Q = N x size_mult, N = max(minimum, 5)
    max_n=20,                            # a market is quoted only while N <= max_n (live-prep: N <= 20)
    inv_cap=5.0,                         # a side stops adding at inv_cap x Q of position its way
    min_width_ticks=2,                   # TB1: a quoting market rests nothing while the raw touch is under this many ticks
    min_width_c=0.0,                     # entries only while the raw touch is at least this many cents wide
    jump_c=15.0, jump_min=60,            # x2's pause: an adjusted-mid jump of jump_c pauses a quoting market jump_min minutes
    range_c=None, range_min=60,          # no entries while the raw mid ranged >= range_c cents over the last range_min
    min_rate=10.0,                       # the programme in force must pay at least this a day for entries
    loss_guard=10.0,                     # no buys while the market's fills are marked this far down
    cap_total=320.0, cap_market=100.0,   # the pot (held at cost + resting buys) and a market's share of it
    exits=True,                          # carried / taken-out markets rest their exits
    two_sided_only=False,                # rest entries only when both sides can rest
    exit_after_min=None,                 # a position older than this is sold at the touch (taker; fee paid)
    R2=None, R1=None, k_vol=None,        # calibration (None: calib.json)
    stop_total=None,                     # a total stop on fills + rewards + rebates (None: none)
    entries_until=None,                  # no entry from this minute (the live stop: close-only after it)
    prog_check_from=None,                # before this minute entries ignore the programme in force (live before Addendum 9)
    guard_from=None,                     # the loss guard from this minute (live: Addendum 14)
    exclude_lptypes=(), exclude_from=None,   # no entry in markets of these pm_lp.ts types (live: AI from Addendum 12)
    exclude_types=(),                    # no entry in markets of these study types (lib.mtype)
)

def P(**kw):
    p = dict(DEFAULT); p.update(kw); return p

# ------------------------------------------------------------------------------------------------- live's own orders
_LIVE_ORDERS = None
def live_orders():
    """Every live order of live-prep as [start, end, side, YES price, size], by cond (sql/live_orders.sql)."""
    global _LIVE_ORDERS
    if _LIVE_ORDERS is None:
        import gzip
        rows = json.load(gzip.open(os.path.join(lib.WORK, 'live_orders.json.gz'), 'rt'))['rows']
        d = collections.defaultdict(list)
        for o in rows:
            cond, ts, outc, side, price, size, state, matched, filled_at, creq, canc, upd, expi, h = o
            if state == 'rejected' or ts is None: continue
            ts = float(ts); price = float(price)
            ends = [float(x) for x in ((filled_at if state == 'filled' else None), canc, (float(expi) - 60) if expi else None) if x is not None]
            end = min(ends) if ends else ts + 60
            sd, y = ((1 if side == 'BUY' else -1), price) if outc == 'yes' else ((-1 if side == 'BUY' else 1), 1 - price)
            d[cond].append((ts, max(end, ts), sd, y, float(size)))
        _LIVE_ORDERS = d
    return _LIVE_ORDERS

def clean_of(cond, t0, t1):
    """Live's own orders resting at each minute's book read (:03.5), to take out of the recorded book."""
    lst = live_orders().get(cond)
    if not lst: return None
    out = {}
    for t in range(t0, t1 + 1):
        x = t * 60 + 3.5
        rs = [o for o in lst if o[0] <= x < o[1]]
        if not rs: continue
        bids = [o for o in rs if o[2] == 1]; asks = [o for o in rs if o[2] == -1]
        b = max(bids, key=lambda o: o[3]) if bids else None; a = min(asks, key=lambda o: o[3]) if asks else None
        out[t] = (b[3] if b else None, sum(o[4] for o in bids if b and abs(o[3] - b[3]) < 1e-9),
                  a[3] if a else None, sum(o[4] for o in asks if a and abs(o[3] - a[3]) < 1e-9))
    return out

_MK = {}
def market(mid_id):
    """A market with live's orders taken out of its book, cached, with the derived arrays every policy reads."""
    if mid_id in _MK: return _MK[mid_id]
    cond = lib.meta().get(mid_id, {}).get('cond')
    z = np.load(os.path.join(lib.WORK, 'mk', f'{mid_id}.npz'))['m']
    cl = clean_of(cond, int(z[0]), int(z[-1])) if cond in live_orders() else None
    M = Market(mid_id, our_orders=cl)
    M.groups = M.print_groups(lag=10, span=60)
    # the raw mid's range over the last 60 minutes (for range pauses) and the adjusted mid's jump from the minute before
    mid = M.mid.copy()
    M.range60 = _rolling_range(M.t, mid, 60)
    mm = M.m
    jump = np.zeros(len(mm)); jump[1:] = np.abs(np.diff(mm)) * 100
    jump[1:][(M.t[1:] - M.t[:-1]) > 5] = 0
    M.jump = np.nan_to_num(jump)
    M.width_t = np.round((M.ba - M.bb) / M.tick, 6)
    M.width_c = (M.ba - M.bb) * 100
    M.Nmin = np.maximum(np.nan_to_num(M.ms, nan=1e9), 5)
    M.place_cache = {}
    M.end_settle = None
    _MK[mid_id] = M
    return M

def _rolling_range(t, x, w):
    out = np.full(len(x), np.nan)
    from collections import deque
    dq_max, dq_min = deque(), deque()
    for i in range(len(x)):
        if np.isnan(x[i]):
            out[i] = np.nan if not dq_max else x[dq_max[0]] - x[dq_min[0]]
            continue
        while dq_max and (t[i] - t[dq_max[0]] >= w): dq_max.popleft()
        while dq_min and (t[i] - t[dq_min[0]] >= w): dq_min.popleft()
        while dq_max and x[dq_max[-1]] <= x[i]: dq_max.pop()
        dq_max.append(i)
        while dq_min and x[dq_min[-1]] >= x[i]: dq_min.pop()
        dq_min.append(i)
        out[i] = x[dq_max[0]] - x[dq_min[0]]
    return out * 100

def placed(M, how, k=0, dist=None):
    key = (how, k, dist)
    if key not in M.place_cache: M.place_cache[key] = M.placed(how, k, dist)
    return M.place_cache[key]


class Book:
    """One market's account in a run."""
    __slots__ = ('net', 'cash', 'cost', 'qpos', 'pause_until', 'opened', 'fills', 'shares', 'formula2', 'formula1', 'paid',
                 'rebate', 'minutes2', 'minutes1', 'mo60', 'fees', 'first_fill')
    def __init__(self):
        self.net = 0.0; self.cash = 0.0; self.cost = 0.0
        self.qpos = {1: (None, 0.0), -1: (None, 0.0)}
        self.pause_until = -1; self.opened = None
        self.fills = 0; self.shares = 0.0; self.formula2 = 0.0; self.formula1 = 0.0; self.paid = 0.0; self.rebate = 0.0
        self.minutes2 = 0; self.minutes1 = 0; self.mo60 = 0.0; self.fees = 0.0; self.first_fill = None


def run(policy, schedule, t0, t1, end_mark=None, record=False):
    """policy: dict (P()). schedule: {day 'YYYY-MM-DD': [(mid_id, rank, start minute or None)]} the markets selected each
    UTC day (rank order). A market held and not selected is carried: it rests its exits only. Returns a result dict."""
    cal = calib()
    R2 = policy['R2'] if policy['R2'] is not None else cal.get('R_engine', cal['R_two'])
    R1 = policy['R1'] if policy['R1'] is not None else 0.0
    kv = policy['k_vol'] if policy['k_vol'] is not None else cal['k_vol']
    rebate_scale = cal.get('rebate_scale', 1.0)
    books = {}
    daily = collections.defaultdict(lambda: collections.Counter())
    sel_today = {}
    day_of = lib.day_of_min
    cur_day = None
    order_today = []
    fills_rec = []
    mdd = collections.defaultdict(lambda: [0.0, 0.0, 0.0])   # (mid, day) -> [rewards, rebates, change of the fills mark]
    lastv = {}; peak_held = 0.0; peak_comm = 0.0
    for t in range(t0, t1 + 1):
        d = day_of(t)
        if d != cur_day:
            cur_day = d
            order_today = schedule.get(d, [])
            sel_today = {mid: (rank, st) for (mid, rank, st) in order_today}
        # the markets this minute: selected (in rank order, from their start) and carried (anything held)
        active = []
        for (mid, rank, st) in order_today:
            if st is not None and t < st: continue
            active.append((mid, True, rank))
        for mid, b in books.items():
            if mid not in sel_today or (sel_today[mid][1] is not None and t < sel_today[mid][1]):
                if abs(b.net) >= 1e-9: active.append((mid, False, 999))
        committed = sum(abs(b.cost) for b in books.values())
        peak_held = max(peak_held, committed)
        for (mid, selected, rank) in active:
            M = market(mid)
            i = M.index.get(t)
            b = books.get(mid)
            if b is None: b = books[mid] = Book()
            if i is None: continue
            mid_px = M.mid[i]
            if np.isnan(mid_px) or np.isnan(M.m[i]): continue
            N = M.Nmin[i]
            Q = N * policy['size_mult']
            rate = M.rate[i]
            prog_ok = (rate >= policy['min_rate']) and (N <= policy['max_n']) and not np.isnan(M.v[i])
            if policy['prog_check_from'] is not None and t < policy['prog_check_from']: prog_ok = (N <= policy['max_n']) and not np.isnan(M.v[i])
            if policy['entries_until'] is not None and t >= policy['entries_until']: prog_ok = False
            if M.lptype in policy['exclude_lptypes'] and (policy['exclude_from'] is None or t >= policy['exclude_from']): prog_ok = False
            if M.type in policy['exclude_types']: prog_ok = False
            quoting = selected and prog_ok
            # x2's pause on a quoting market
            if quoting and policy['jump_c'] and M.jump[i] >= policy['jump_c'] - 1e-9:
                b.pause_until = t + policy['jump_min']
            paused = quoting and t < b.pause_until
            # the market's fills marked at the adjusted mid (the loss guard)
            mark_adj = b.cash + b.net * M.m[i]
            guard = policy['loss_guard'] is not None and mark_adj <= -policy['loss_guard'] and (policy['guard_from'] is None or t >= policy['guard_from'])
            entry_ok = quoting and not paused
            if entry_ok and policy['min_width_ticks'] and M.width_t[i] < policy['min_width_ticks'] - 1e-9: entry_ok = False
            if entry_ok and policy['min_width_c'] and M.width_c[i] < policy['min_width_c'] - 1e-9: entry_ok = False
            if entry_ok and policy['range_c'] is not None and M.range60[i] >= policy['range_c'] - 1e-9: entry_ok = False
            if paused: rest_any = False
            elif quoting and policy['min_width_ticks'] and M.width_t[i] < policy['min_width_ticks'] - 1e-9: rest_any = False   # TB1 rests nothing
            else: rest_any = True
            eb, ea = placed(M, policy['place'], policy['k'], policy['dist'])
            xb, xa = placed(M, policy['exit_place'], policy['exit_k'])
            bid = ask = None   # (price, size, is_buy)
            if rest_any:
                net = b.net
                # the bid side: reduces a short (a SELL of NO) or adds YES (a BUY)
                if net <= -min(Q, 5.0) + 1e-9 and policy['exits'] and not np.isnan(xb[i]):
                    bid = (xb[i], min(Q, -net), False)
                elif entry_ok and net < policy['inv_cap'] * Q - 1e-9 and not np.isnan(eb[i]) and not guard:
                    bid = (eb[i], Q, True)
                if net >= min(Q, 5.0) - 1e-9 and policy['exits'] and not np.isnan(xa[i]):
                    ask = (xa[i], min(Q, net), False)
                elif entry_ok and net > -policy['inv_cap'] * Q + 1e-9 and not np.isnan(ea[i]) and not guard:
                    ask = (ea[i], Q, True)
                if not quoting:   # carried or out of the programme: exits only
                    if bid and bid[2]: bid = None
                    if ask and ask[2]: ask = None
                if policy['two_sided_only'] and quoting and (bid is None or ask is None):
                    if bid and bid[2]: bid = None
                    if ask and ask[2]: ask = None
            # capital: buys funded in rank order inside the pot and the market's cap
            for side in (1, -1):
                q = bid if side == 1 else ask
                if q is None or not q[2]: continue
                need = q[0] * q[1] if side == 1 else (1 - q[0]) * q[1]
                if committed + need > policy['cap_total'] + 1e-9 or abs(b.cost) + need > policy['cap_market'] + 1e-9:
                    if side == 1: bid = None
                    else: ask = None
                else:
                    committed += need
            peak_comm = max(peak_comm, committed)
            # reward: what rests scores the minute (sizes under the minimum score nothing)
            q1 = q2 = 0.0
            v = M.v[i]; mm = M.m[i]; ms = M.ms[i]
            if bid is not None:
                s = (mm - bid[0]) * 100
                if 0 <= s < v and bid[1] >= ms - 1e-9: q1 = ((v - s) / v) ** 2 * bid[1]
            if ask is not None:
                s = (ask[0] - mm) * 100
                if 0 <= s < v and ask[1] >= ms - 1e-9: q2 = ((v - s) / v) ** 2 * ask[1]
            if (q1 > 0 or q2 > 0) and rate > 0:
                oth = M.others[i]
                two = min(q1, q2)
                f2 = rate / 1440 * two / (two + oth) if two > 0 else 0.0
                one = max(q1, q2) / 3 if M.inrange[i] else 0.0
                f1 = rate / 1440 * one / (one + oth) - f2 if one > two else 0.0
                b.formula2 += f2; b.formula1 += max(0.0, f1)
                pay = R2 * f2 + R1 * max(0.0, f1)
                b.paid += pay
                daily[d]["paid"] += pay; daily[d]["formula2"] += f2; mdd[(mid, d)][0] += pay
                if two > 0: b.minutes2 += 1; daily[d]['minutes2'] += 1
                elif max(q1, q2) > 0: b.minutes1 += 1; daily[d]['minutes1'] += 1
            # fills
            rows = M.groups.get(t)
            for side in (1, -1):
                q = bid if side == 1 else ask
                if q is None:
                    b.qpos[side] = (None, 0.0); continue
                px, size, isbuy = q
                if side == 1:
                    top = np.isnan(M.bb[i]) or px > M.bb[i] + 1e-9
                    ahead = np.nansum(np.where(M.bp[i] > px + 1e-9, M.bs[i], 0)); same = np.nansum(np.where(np.abs(M.bp[i] - px) < 1e-9, M.bs[i], 0))
                else:
                    top = np.isnan(M.ba[i]) or px < M.ba[i] - 1e-9
                    ahead = np.nansum(np.where(M.ap[i] < px - 1e-9, M.as_[i], 0)); same = np.nansum(np.where(np.abs(M.ap[i] - px) < 1e-9, M.as_[i], 0))
                lastpx, lastq = b.qpos[side]
                qp = (min(lastq, same) if (lastpx is not None and abs(lastpx - px) < 1e-9) else (0.0 if top else same))
                b.qpos[side] = (px, qp)
                if not rows: continue
                D = 0.0 if top else ahead + qp
                left = size; used = 0.0
                want = -1 if side == 1 else 1
                for (ts, dd, y, s) in rows:
                    if dd != want or left <= 1e-9: continue
                    if (side == 1 and y > px + 1e-9) or (side == -1 and y < px - 1e-9): continue
                    f = max(0.0, used + s - D) - max(0.0, used - D); used += s
                    f = min(left, f * kv)
                    if f <= 1e-9: continue
                    left -= f
                    # position and cost (average cost; a fill that reduces takes its share of the cost out)
                    dq = side * f
                    if b.net == 0 or (b.net > 0) == (dq > 0):
                        b.cost += f * (px if dq > 0 else (1 - px))
                    else:
                        red = min(abs(b.net), f)
                        b.cost -= b.cost * red / abs(b.net)
                        if f > red: b.cost += (f - red) * (px if dq > 0 else (1 - px))
                    b.net += dq; b.cash -= dq * px
                    if abs(b.net) < 1e-9: b.net = 0.0; b.cost = 0.0
                    b.fills += 1; b.shares += f
                    fr, sh = lib.fee_and_share(M.meta.get('fee'))
                    reb = rebate_scale * sh * fr * px * (1 - px) * f
                    b.rebate += reb; daily[d]["rebate"] += reb; mdd[(mid, d)][1] += reb
                    daily[d]['fills'] += 1; daily[d]['shares'] += f
                    j = np.searchsorted(M.t, t + 61)
                    mo = None
                    for jj in range(j, min(j + 30, len(M.t))):
                        if not np.isnan(M.mid[jj]): mo = M.mid[jj]; break
                    if mo is not None: b.mo60 += side * (mo - px) * f; daily[d]['mo60'] += side * (mo - px) * f
                    if record: fills_rec.append((t, mid, side, px, f, mo))
                    if b.first_fill is None: b.first_fill = t
                if left < size - 1e-9:
                    b.qpos[side] = (px, 0.0) if left > 1e-9 else (None, 0.0)
            committed = sum(abs(bb.cost) for bb in books.values()) if rows else committed
        # end of the UTC day: mark every book
        if (t + 1) % 1440 == 0 or t == t1:
            tot = 0.0
            for mid, b in books.items():
                M = market(mid)
                j = np.searchsorted(M.t, t, side='right') - 1
                mk = None
                while j >= 0:
                    if not np.isnan(M.mid[j]): mk = M.mid[j]; break
                    j -= 1
                v_ = b.cash + b.net * (mk if mk is not None else 0.0); tot += v_; mdd[(mid, d)][2] = v_ - lastv.get(mid, 0.0); lastv[mid] = v_
            daily[d]['mtm'] = tot
            daily[d]['held'] = sum(abs(b.cost) for b in books.values())
    # the end: every book at its last mid (or a settlement mark given)
    res = {'policy': policy, 'daily': {k: dict(v) for k, v in daily.items()}, 'books': {}}
    tot_fill = 0.0
    for mid, b in books.items():
        M = market(mid)
        mk = None
        if end_mark and mid in end_mark: mk = end_mark[mid]
        else:
            j = np.searchsorted(M.t, t1, side='right') - 1
            while j >= 0:
                if not np.isnan(M.mid[j]): mk = M.mid[j]; break
                j -= 1
        pnl = b.cash + b.net * (mk if mk is not None else 0.0)
        tot_fill += pnl
        res['books'][mid] = dict(cond=M.cond, type=M.type, pnl=pnl, net=b.net, fills=b.fills, shares=b.shares, paid=b.paid, rebate=b.rebate,
                                 formula2=b.formula2, formula1=b.formula1, minutes2=b.minutes2, minutes1=b.minutes1, mo60=b.mo60)
    res['fills_pnl'] = tot_fill
    res['paid'] = sum(b.paid for b in books.values()); res['rebate'] = sum(b.rebate for b in books.values())
    res['formula2'] = sum(b.formula2 for b in books.values())
    res['total'] = res['fills_pnl'] + res['paid'] + res['rebate']
    res['days'] = (t1 - t0 + 1) / 1440
    res['fills'] = sum(b.fills for b in books.values()); res['shares'] = sum(b.shares for b in books.values())
    res['mo60'] = sum(b.mo60 for b in books.values())
    res['md'] = {f'{k[0]}|{k[1]}': v for k, v in mdd.items()}
    res['peak_held'] = peak_held; res['peak_committed'] = peak_comm
    if record: res['fills_rec'] = fills_rec
    # day by day: rewards and rebates of the day plus the change of the books' mark
    prev = 0.0
    for d in sorted(res['daily']):
        x = res['daily'][d]
        x['fills_day'] = x.get('mtm', prev) - prev; prev = x.get('mtm', prev)
        x['total'] = x['fills_day'] + x.get('paid', 0.0) + x.get('rebate', 0.0)
    return res
