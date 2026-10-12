# LP-ADVERSE: candidate rule changes priced on live-prep's own live record (2026-10-09 01:32 -> the stop at 10-12 07:30,
# exits to 22:49), each as a change from what happened, with its reward cost and a market-day bootstrap.
#   LPADV_WORK=<scratch> python3 -I docs/agents/backtests/lpadverse/scripts/rules.py > docs/agents/backtests/lpadverse/results/rules.txt
#
# The book-keeping. Every BUY is a lot of its token; every SELL closes lots of its token first in, first out; a resolved
# market's lots close at its payout; what is still held is marked at the last mid (YES at m, NO at 1 - m). A lot's P&L is
# its exits' proceeds less its cost plus what is left at the mark, so the lots sum to the fills P&L (pnl.py). A rule that
# would not have bought a lot drops the lot and the exits that closed it. Rewards: each market-day's payout (paid +
# sponsored; 10-12, not yet paid, at R = 0.75 on the minutes' formula) is spread over that market-day's minutes in
# proportion to the formula each minute scored; a rule that rests nothing (or one side only) in a minute loses that
# minute's share. Maker rebates go with the shares filled (the record's rebate per filled share). Per day: over the 3.25
# quoting days from the go (10-09 01:32) to the stop (10-12 07:30). Capital a rule frees is NOT re-used here: rules that
# hold less stock would also quote more minutes, which this does not credit (said where it matters).
import sys, os, pickle, bisect, json, random, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

R_LIVE = 0.75
F = pickle.load(open(os.path.join(WORK, 'fills2.pkl'), 'rb'))
FB = pickle.load(open(os.path.join(WORK, 'fills.pkl'), 'rb'))
settle = FB['settle']
raw = {f['trade_id']: f for f in jload('live_fills.json')['rows']}
aux = jload('live_aux.json')
lm = []
for d in ('1009', '1010', '1011', '1012'): lm.extend(jload(f'lm_{d}.json.gz')['rows'])
tg = jload('targets.json')['ids']
cond_of_id = {r[0]: r[1] for r in tg}
fee_type = {r[1]: r[7] for r in tg}
rb = pickle.load(open(os.path.join(WORK, 'books.pkl'), 'rb'))
mids = Mids(lm, rb['books'], cond_of_id)
GO, STOP = ep('2026-10-09T01:32:00+00:00'), ep('2026-10-12T07:30:00+00:00')
DAYS = (STOP - GO) / 86400
FEE = {'politics_fees': 0.04, 'finance_prices_fees': 0.04, 'tech_fees': 0.04, 'mentions_fees': 0.04, 'culture_fees': 0.05,
       'economics_fees': 0.05, 'weather_fees': 0.05, 'general_fees': 0.05, 'sports_fees_v2': 0.05, 'sports_fees_v3': 0.05,
       'crypto_fees_v2': 0.07, None: 0.0}

fills = sorted(F, key=lambda r: r['t'])
for i, r in enumerate(fills): r['i'] = i
qtype = {r['cond']: r['type'] for r in fills}
for m in aux['markets']: qtype.setdefault(m['cond'], mtype(m['question']))
end_of = {}
for r in fills: end_of[r['cond']] = r['end']
for m in aux['markets']:
    if m['cond'] not in end_of or end_of[m['cond']] is None: end_of[m['cond']] = ep(m['end_date']) if m['end_date'] else None
V = {r['cond']: r['V_now'] for r in fills}

# ---------------------------------------------------------------- lots
def build_lots(fs):
    """FIFO lots per token from fills in time order. Returns lots and unmatched sells."""
    q, lots, orphan = {}, [], []
    for r in fs:
        key = (r['cond'], r['outcome'])
        if r['side'] == 'BUY':
            L = {'f': r, 'qty': r['size'], 'px': r['price'], 'rem': r['size'], 'exits': [], 'cond': r['cond'], 'out': r['outcome'], 't': r['t']}
            q.setdefault(key, []).append(L); lots.append(L)
        else:
            left = r['size']
            for L in q.get(key, []):
                if left <= 1e-9: break
                if L['rem'] <= 1e-9: continue
                x = min(L['rem'], left); L['rem'] -= x; left -= x
                L['exits'].append((x, r['price'], r['t'], r))
            if left > 1e-6: orphan.append((r, left))
    return lots, orphan

def mark_token(cond, out):
    v = V[cond]
    return v if out == 'yes' else 1 - v

def lot_pnl(L, px=None, scale=1.0, exit_fn=None):
    """A lot's P&L to now. px: a different buy price; scale: a smaller lot (exits scaled alike); exit_fn: replaces the
    exits (returns a list of (qty, price, fee) closing the lot)."""
    bpx = L['px'] if px is None else px
    if exit_fn is not None:
        ex = exit_fn(L)
        closed = sum(x for x, p, fee in ex)
        return scale * (sum(x * (p - bpx) - fee for x, p, fee in ex) + (L['qty'] - closed) * (mark_token(L['cond'], L['out']) - bpx))
    s = sum(x * (p - bpx) for x, p, t, r in L['exits'])
    return scale * (s + L['rem'] * (mark_token(L['cond'], L['out']) - bpx))

lots, orphan = build_lots(fills)
base_fills = sum(lot_pnl(L) for L in lots)

# ---------------------------------------------------------------- rewards and rebates by market-day
rd = {(r['day'], r['cond']): r for r in aux['reward_days']}
form_md, mins_md = {}, {}
for r in lm:
    k = (day_of(r[0]), r[1])
    form_md[k] = form_md.get(k, 0.0) + float(r[12] or 0)
    mins_md.setdefault(k, []).append(r)
paid_md = {}
for k in set(form_md) | {(d, c) for d, c in rd}:
    x = rd.get(k)
    if x is not None and k[0] < '2026-10-12':
        paid_md[k] = float(x['paid'] or 0) + float(x['sponsored'] or 0)
    elif k[0] == '2026-10-12':
        paid_md[k] = R_LIVE * form_md.get(k, 0.0)
sh_by_day = {}
for r in fills: sh_by_day[r['day']] = sh_by_day.get(r['day'], 0) + r['size']
reb_known = sum(float(x['rebate'] or 0) for k, x in rd.items() if k[0] < '2026-10-12')
sh_known = sum(v for d, v in sh_by_day.items() if d < '2026-10-12')
REB_SH = reb_known / sh_known
reb_total = reb_known + REB_SH * sh_by_day.get('2026-10-12', 0)
base_paid = sum(paid_md.values())
base = base_fills + base_paid + reb_total
md_of_lot = lambda L: (L['f']['day'], L['cond'])

# minute reward share
def minute_reward(r):
    k = (day_of(r[0]), r[1]); f = form_md.get(k, 0.0)
    return paid_md.get(k, 0.0) * float(r[12] or 0) / f if f > 0 else 0.0

# ---------------------------------------------------------------- minute features
def width_at(cond, t):
    k, v = mids.at(cond, t - 5, tol=600, after=False)
    if not v or v[0] is None or v[1] is None: return None
    return 100 * (v[1] - v[0])

from collections import deque
ROLL = {}
def _roll(cond, win):
    """The mid's range (cents) over the `win` seconds up to each recorded minute of `cond` (None under 3 mids)."""
    ks = mids.keys.get(cond) or []
    out = []
    qmax, qmin, pts = deque(), deque(), deque()
    for k in ks:
        m = Mids.midof(mids.s[cond][k])
        if m is not None:
            pts.append(k)
            while qmax and qmax[-1][1] <= m: qmax.pop()
            qmax.append((k, m))
            while qmin and qmin[-1][1] >= m: qmin.pop()
            qmin.append((k, m))
        while pts and pts[0] < k - win: pts.popleft()
        while qmax and qmax[0][0] < k - win: qmax.popleft()
        while qmin and qmin[0][0] < k - win: qmin.popleft()
        out.append(100 * (qmax[0][1] - qmin[0][1]) if len(pts) >= 3 and qmax and qmin else None)
    return ks, out
def range_before(cond, t, win):
    key = (cond, win)
    if key not in ROLL: ROLL[key] = _roll(cond, win)
    ks, out = ROLL[key]
    i = bisect.bisect_right(ks, int(t)) - 1
    if i < 0 or t - ks[i] > 900: return None
    return out[i]

def days_left(cond, t):
    e = end_of.get(cond)
    return None if e is None else (e - t) / 86400

# ---------------------------------------------------------------- evaluation
mds = sorted(set(paid_md) | {md_of_lot(L) for L in lots})
def evaluate(keep_lot=None, lot_value=None, minute_frac=None, extra_md=None):
    """Per market-day contribution under a rule: (fills, rewards, rebates). keep_lot(L) -> bool; lot_value(L) -> P&L or
    None (dropped); minute_frac(r) -> share of the minute's reward kept."""
    out = {k: [0.0, 0.0, 0.0] for k in mds}
    for L in lots:
        k = md_of_lot(L)
        if keep_lot is not None and not keep_lot(L): continue
        v = lot_value(L) if lot_value is not None else lot_pnl(L)
        if v is None: continue
        out.setdefault(k, [0.0, 0.0, 0.0])
        out[k][0] += v
        sh = L['qty'] + sum(x for x, p, t, r in L['exits'])
        out[k][2] += REB_SH * sh
    for k in mds:
        if minute_frac is None:
            out[k][1] += paid_md.get(k, 0.0)
        else:
            f = form_md.get(k, 0.0)
            if f <= 0:
                out[k][1] += paid_md.get(k, 0.0); continue
            out[k][1] += sum(minute_reward(r) * minute_frac(r) for r in mins_md.get(k, []))
    return out

BASE = evaluate()
def total(o): return sum(sum(v) for v in o.values())
base_total = total(BASE)

OWN = {}
def boot_delta(o, n=2000, seed=20261012):
    """5th / 95th percentiles of the change a day and P(change > 0), resampling market-days; the rule's own total a day
    over the same draws goes to OWN."""
    rnd = random.Random(seed); ks = list(mds); res = []; own = []
    for _ in range(n):
        s = s2 = 0.0
        for _ in ks:
            k = ks[rnd.randrange(len(ks))]
            s += sum(o.get(k, (0, 0, 0))) - sum(BASE.get(k, (0, 0, 0))); s2 += sum(o.get(k, (0, 0, 0)))
        res.append(s / DAYS); own.append(s2 / DAYS)
    res.sort(); own.sort()
    OWN['last'] = (own[int(0.05 * n)], own[int(0.95 * n)])
    return res[int(0.05 * n)], res[int(0.95 * n)], sum(1 for x in res if x > 0) / n

def mday_sign(o):
    """In how many of the four UTC days the change is positive."""
    by = {}
    for k in mds:
        by[k[0]] = by.get(k[0], 0.0) + sum(o.get(k, (0, 0, 0))) - sum(BASE.get(k, (0, 0, 0)))
    return sum(1 for v in by.values() if v > 0), len(by)

results = []
def report(name, o, why=''):
    f = sum(v[0] for v in o.values()) - sum(v[0] for v in BASE.values())
    w = sum(v[1] for v in o.values()) - sum(v[1] for v in BASE.values())
    b = sum(v[2] for v in o.values()) - sum(v[2] for v in BASE.values())
    d = (f + w + b) / DAYS
    lo, hi, p = boot_delta(o)
    pos, nd = mday_sign(o)
    results.append((name, d, lo, hi, p, f, w, b, pos, nd, why))
    own = total(o) / DAYS; olo, ohi = OWN['last']
    print(f"{name:<58}{d:>+8.2f}{lo:>+9.2f}{hi:>+8.2f}{p:>6.2f}   own {own:>+7.2f} [{olo:>+7.2f}, {ohi:>+7.2f}]  fills {f:>+8.2f}  rewards {w:>+7.2f}  rebates {b:>+6.2f}  days+ {pos}/{nd}  {why}")

print("LP-ADVERSE: rule changes priced on the live record. Base (what happened):")
print(f"  fills P&L to now {base_fills:.2f} (lots; pnl.py's -129.43), rewards {base_paid:.2f} (10-09..10-11 paid {sum(v for k, v in paid_md.items() if k[0] < '2026-10-12'):.2f},"
      f" 10-12 at R {R_LIVE} {sum(v for k, v in paid_md.items() if k[0] == '2026-10-12'):.2f}), rebates {reb_total:.2f} ({reb_known:.2f} booked + 10-12 at {100 * REB_SH:.3f} c a filled share)")
print(f"  total {base_total:.2f} over {DAYS:.2f} quoting days = {base_total / DAYS:+.2f} a day; unmatched sells: {len(orphan)}")
shares = sum(r['size'] for r in fills)
form_ll = sum(form_md.values()) - sum(v for k, v in form_md.items() if k[0] == '2026-10-09') + 8.081876
print(f"  per filled share: rewards {100 * base_paid / shares:.2f} c, rebates {100 * reb_total / shares:.2f} c, fills {100 * base_fills / shares:.2f} c "
      f"({shares:.0f} shares). Formula like for like {form_ll:.2f}: the R that would break even is {-(base_fills + reb_total) / form_ll:.2f}")
print(f"\n{'change from what happened':<58}{'$/day':>8}{'5%':>9}{'95%':>8}{'P>0':>6}   own: the rule's own record a day [5%, 95%]; the change's parts over the record; days+: UTC days it was positive")

# 1. market types out
for T in sorted({qtype[c] for c in qtype}):
    o = evaluate(keep_lot=lambda L, T=T: qtype[L['cond']] != T, minute_frac=lambda r, T=T: 0.0 if qtype.get(r[1]) == T else 1.0)
    report(f"type out: {T}", o)
for Ts in (('view-count', 'statements'), ('view-count', 'statements', 'AI release'), ('view-count', 'statements', 'AI release', 'elections')):
    o = evaluate(keep_lot=lambda L, Ts=Ts: qtype[L['cond']] not in Ts, minute_frac=lambda r, Ts=Ts: 0.0 if qtype.get(r[1]) in Ts else 1.0)
    report("types out: " + ' + '.join(Ts), o)

# 2. days to the scheduled end
for X in (1, 2, 3, 7, 14):
    o = evaluate(keep_lot=lambda L, X=X: (days_left(L['cond'], L['t']) is None) or days_left(L['cond'], L['t']) >= X,
                 minute_frac=lambda r, X=X: 0.0 if (days_left(r[1], r[0]) is not None and days_left(r[1], r[0]) < X) else 1.0)
    report(f"no buy and no quote within {X} day(s) of the end", o)

# 3. the touch's width (the book without ours where live-prep watched it)
def lm_width(r):
    return None if r[2] is None or r[3] is None else 100 * (float(r[3]) - float(r[2]))
for W in (2, 3, 4, 5):
    o = evaluate(keep_lot=lambda L, W=W: (width_at(L['cond'], L['t']) or 99) >= W - 1e-6,
                 minute_frac=lambda r, W=W: 0.0 if (lm_width(r) is not None and lm_width(r) < W - 1e-6) else 1.0)
    report(f"quote only where the touch is {W} c wide or more", o)

# 4. recent volatility of the mid
for win, X in ((3600, 3), (3600, 6), (3600, 10), (900, 2), (900, 4), (86400, 20), (86400, 40)):
    lab = f"{win // 60} min" if win < 86400 else '24 h'
    o = evaluate(keep_lot=lambda L, win=win, X=X: (range_before(L['cond'], L['t'], win) or 0) < X,
                 minute_frac=lambda r, win=win, X=X: 0.0 if (range_before(r[1], r[0], win) or 0) >= X else 1.0)
    report(f"no quote while the mid ranged >= {X} c over the last {lab}", o)

# 5. deeper quotes: an entry k ticks further from the mid fills only if the taker's own trade reached that price.
def deeper_value(k, strict):
    def fn(L):
        f = L['f']; r = raw[f['trade_id']]; tick = f['tick'] or 0.01
        d = f['d']; y = f['y']
        ys = [(float(m[2]) if str(m[0]).lower() == 'yes' else 1 - float(m[2]), float(m[3])) for m in (r.get('makers') or [])]
        lvl = y - d * k * tick              # the deeper YES-equivalent price
        if strict: avail = sum(s for p, s in ys if d * (lvl - p) > 1e-9)
        else: avail = sum(s for p, s in ys if d * (lvl - p) > -1e-9)
        # shares at or past the deeper level, less ours (the taker took ours first, deeper it would take the next)
        q = min(L['qty'], max(0.0, avail - (L['qty'] if d * (lvl - y) > -1e-9 else 0)))
        if q <= 1e-9: return None
        better = k * tick                   # the token's own price improves by k ticks
        return lot_pnl(L, px=L['px'] - better, scale=q / L['qty'])
    return fn
def deeper_frac(k):
    def fn(r):
        f = float(r[12] or 0)
        if f <= 0: return 1.0
        v = float(r[14] or 0); m = r[20]; tick = float(r[16] or 0.01)
        if not v or m is None or r[6] is None or r[7] is None or r[19] is None: return 1.0
        m = float(m); sb = 100 * (m - float(r[6])); sa = 100 * (float(r[7]) - m)
        sz_b = float(r[8] or 0); sz_a = float(r[9] or 0)
        S = lambda s: ((v - s) / v) ** 2 if 0 <= s < v else 0.0
        ours0 = float(r[19]); q1 = float(r[17] or 0); q2 = float(r[18] or 0)
        others = (max(min(q1, q2), (q1 + q2) / 3) if 0.10 <= m <= 0.90 else min(q1, q2))
        ours1 = min(S(sb + 100 * k * tick) * sz_b, S(sa + 100 * k * tick) * sz_a)
        if ours0 <= 0: return 1.0
        f1 = ours1 / (ours1 + others) if ours1 > 0 else 0.0
        f0 = ours0 / (ours0 + others)
        return f1 / f0 if f0 > 0 else 1.0
    return fn
for k in (1, 2, 3):
    for strict in (False, True):
        o = evaluate(lot_value=deeper_value(k, strict), minute_frac=deeper_frac(k))
        report(f"entries {k} tick(s) further from the mid ({'past it' if strict else 'reached'})", o)

# 6. an inventory cap per market, kN of YES-equivalent net (buys past it are not made; minutes held there quote one side)
nsize = {}
for r in lm: nsize[r[1]] = max(float(r[15] or 5), 5.0)
def inv_keep(kN):
    keep = set(); net = {}
    for r in fills:
        c = r['cond']; N = nsize.get(c, 20.0)
        if r['side'] == 'BUY':
            nn = net.get(c, 0.0) + r['d'] * r['size']
            if abs(nn) <= kN * N + 1e-6:
                keep.add(r['i']); net[c] = nn
        else:
            net[c] = net.get(c, 0.0) + r['d'] * r['size']
    return keep
def inv_frac(kN):
    def fn(r):
        hy, hn = float(r[21] or 0), float(r[22] or 0); N = max(float(r[15] or 5), 5.0)
        return 0.0 if abs(hy - hn) >= kN * N - 1e-6 and float(r[12] or 0) > 0 else 1.0
    return fn
for kN in (1, 2, 3):
    ks = inv_keep(kN)
    o = evaluate(keep_lot=lambda L, ks=ks: L['f']['i'] in ks, minute_frac=inv_frac(kN))
    report(f"inventory cap {kN}N a market (now 5N)", o, 'minutes held at the cap lose their reward')

# 7. faster exits: what is still held X minutes after the buy is sold at the bid (taker, the market's fee)
def bid_of(cond, out, t):
    k, v = mids.at(cond, t, tol=900, after=True)
    if not v or v[0] is None or v[1] is None: return None
    return v[0] if out == 'yes' else 1 - v[1]
def taker_exit(X):
    def fn(L):
        ex = [(x, p, 0.0) for x, p, t, r in L['exits'] if t <= L['t'] + X]
        closed = sum(x for x, p, fee in ex)
        left = L['qty'] - closed
        s = settle.get(L['cond'])
        if left > 1e-9:
            if s and s[1] <= L['t'] + X:
                ex.append((left, s[0] if L['out'] == 'yes' else 1 - s[0], 0.0))
            else:
                b = bid_of(L['cond'], L['out'], L['t'] + X)
                if b is None: return [(x, p, 0.0) for x, p, t, r in L['exits']]
                rate = FEE.get(fee_type.get(L['cond']), 0.05)
                ex.append((left, b, left * rate * b * (1 - b)))
        return ex
    return fn
for X in (60, 300, 900, 3600, 6 * 3600):
    o = evaluate(lot_value=lambda L, X=X: lot_pnl(L, exit_fn=taker_exit(X)))
    report(f"sell what is left {X // 60} min after the buy, at the bid", o, 'taker fee incl.; capital freed not credited')
o = evaluate(lot_value=lambda L: lot_pnl(L, exit_fn=lambda L: [(x, (s[0] if L['out'] == 'yes' else 1 - s[0]), 0.0) for x in [L['qty']] for s in [settle.get(L['cond'])] if s]))
report("hold every lot to the end (no exits at all)", o, 'diagnostic: the exits\' own effect')

# 8. a tighter per-market loss guard: no buy (and no reward) while the market's fills are marked L or more down
def guard_state(Lim):
    """For each fill and each minute, whether the market's fills so far are marked <= -Lim at the mid then."""
    byc = {}
    for r in fills: byc.setdefault(r['cond'], []).append(r)
    blocked_fill = set(); blocked_min = set()
    for c, fs in byc.items():
        ts = [r['t'] for r in fs]
        def marked(t):
            m = mids.mid(c, t, tol=900, after=False)
            cash = held = 0.0
            for r in fs:
                if r['t'] >= t: break
                cash -= r['d'] * r['y'] * r['size']; held += r['d'] * r['size']
            s = settle.get(c)
            if s and s[1] <= t: m = s[0]
            if m is None: return 0.0
            return cash + held * m
        for r in fs:
            if r['side'] == 'BUY' and marked(r['t']) <= -Lim: blocked_fill.add(r['i'])
        for row in mins_md_by_cond.get(c, []):
            if row[0] < ts[0]: continue
            if marked(row[0]) <= -Lim: blocked_min.add((c, row[0]))
    return blocked_fill, blocked_min
mins_md_by_cond = {}
for r in lm: mins_md_by_cond.setdefault(r[1], []).append(r)
for Lim in (10, 5, 3):
    bf, bm = guard_state(Lim)
    o = evaluate(keep_lot=lambda L, bf=bf: L['f']['i'] not in bf, minute_frac=lambda r, bm=bm: 0.0 if (r[1], r[0]) in bm else 1.0)
    report(f"per-market loss guard at ${Lim} from the first fill (now $10, in code)", o,
           'the $10 row re-prices the guard already running: ~0 expected')

# 9. one-sided: entries that add YES only (d = +1), or only d = -1
for dd in (1, -1):
    for share in (0.0, 1 / 3):
        o = evaluate(keep_lot=lambda L, dd=dd: L['f']['d'] == dd, minute_frac=lambda r, share=share: share)
        report(f"entries d = {dd:+d} only, one-sided reward {share:.2f} of two-sided", o)

# 10. selection: leave out a market-day whose mid ranged >= X over the 24 h before its first minute that day
first_min = {}
for r in lm:
    k = (day_of(r[0]), r[1])
    first_min[k] = min(first_min.get(k, 1e18), r[0])
for X in (10, 20, 40):
    bad = {k for k, t in first_min.items() if (range_before(k[1], t, 86400) or 0) >= X}
    o = evaluate(keep_lot=lambda L, bad=bad: md_of_lot(L) not in bad, minute_frac=lambda r, bad=bad: 0.0 if (day_of(r[0]), r[1]) in bad else 1.0)
    report(f"leave out a market-day whose mid ranged >= {X} c in the 24 h before", o, f"{len(bad)} market-days out")

# 11. combinations with a mechanism
def combo(types=('view-count', 'statements'), W=None, k=None, X=None):
    kl = lambda L: qtype[L['cond']] not in types and (W is None or (width_at(L['cond'], L['t']) or 99) >= W - 1e-6) and (X is None or (range_before(L['cond'], L['t'], 3600) or 0) < X)
    def mf(r):
        if qtype.get(r[1]) in types: return 0.0
        if W is not None and lm_width(r) is not None and lm_width(r) < W - 1e-6: return 0.0
        if X is not None and (range_before(r[1], r[0], 3600) or 0) >= X: return 0.0
        return deeper_frac(k)(r) if k else 1.0
    lv = (lambda L: deeper_value(k, False)(L) if kl(L) else None) if k else (lambda L: lot_pnl(L) if kl(L) else None)
    return evaluate(lot_value=lv, minute_frac=mf)
report("view-count + statements out, touch >= 3 c", combo(W=3))
report("view-count + statements out, 1 tick deeper", combo(k=1))
report("view-count + statements out, touch >= 3 c, 1 tick deeper", combo(W=3, k=1))
report("view-count + statements out, no quote after a 6 c hour", combo(X=6))
report("view-count + statements out, touch >= 3 c, no quote after a 6 c hour", combo(W=3, X=6))

# 12. the packages proposed (each part has a mechanism and held its sign on the paper samples, rules_paper.txt)
def package(X=10, W=3, types=(), guard=None, k=None):
    bf = guard_state(guard)[0] if guard else set()
    bm = guard_state(guard)[1] if guard else set()
    def kl(L):
        c, t = L['cond'], L['t']
        if qtype[c] in types: return False
        if W is not None and (width_at(c, t) or 99) < W - 1e-6: return False
        if X is not None and (range_before(c, t, 3600) or 0) >= X: return False
        if L['f']['i'] in bf: return False
        return True
    def mf(r):
        if qtype.get(r[1]) in types: return 0.0
        if W is not None and lm_width(r) is not None and lm_width(r) < W - 1e-6: return 0.0
        if X is not None and (range_before(r[1], r[0], 3600) or 0) >= X: return 0.0
        if (r[1], r[0]) in bm: return 0.0
        return deeper_frac(k)(r) if k else 1.0
    lv = (lambda L: deeper_value(k, True)(L) if kl(L) else None) if k else (lambda L: lot_pnl(L) if kl(L) else None)
    return evaluate(lot_value=lv, minute_frac=mf)
print("\npackages:")
report("P1: no quote after a 10 c hour + touch >= 3 c", package(X=10, W=3))
report("P2: P1 + view-count and statements out", package(X=10, W=3, types=('view-count', 'statements')))
report("P3: P2 + per-market guard $5", package(X=10, W=3, types=('view-count', 'statements'), guard=5))
report("P4: P1 + entries 1 tick further (past it)", package(X=10, W=3, k=1))
report("P5: no quote after a 10 c hour alone (= the 10 c row)", package(X=10, W=None))
report("P6: no quote after a 6 c hour + touch >= 3 c", package(X=6, W=3))
pickle.dump({'results': results, 'base': base_total, 'days': DAYS}, open(os.path.join(WORK, 'rules.pkl'), 'wb'))
print(f"\nBase per day {base_total / DAYS:+.2f}. A rule's $/day is the change; base + change is the rule's own record.")
