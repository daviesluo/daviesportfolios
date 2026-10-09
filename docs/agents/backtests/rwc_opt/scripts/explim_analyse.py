# EXPENSIVE-LIMIT (2026-10-09): the per-market limit on BUYING a near-certain token as a share f of the path's capital C,
# from scripts/explim_run.ts's four files and the calibration's hourly prices.
#   python3 -I scripts/explim_analyse.py <dir of exp_calib_fetch.py's markets.jsonl / hist.jsonl>   (from this folder)
# 1. The copy's check: explim's L1 and "usd 50 mark 0.95" equal EXPENSIVE-SIDE's committed exp_*.json day for day.
# 2. Each f x thr at C = $320 against L1 on the four cells (RW strict / at-price, full universe strict / at-price): the
#    difference at R = 0.40 (total less 0.6 of the formula rewards), the paired day bootstrap (random.Random(20261023),
#    2,000 draws, index 100) and P(> 0), and what the arm still holds (largest one-market holding at the mark in tokens
#    >= 0.90; minutes with >= $50 of it).
# 3. The tail of each arm's simulated holdings, by EXPENSIVE-SIDE's jump model (exp_calib.py's: every hourly sample of a
#    market holding H $ at the mark in a token at p meets its band's hourly chance q of a >= 25 c fall and the empirical
#    share r of value lost 24 hours later): the expected jump loss per 30 days, the expected loss per 30 days from single
#    events of >= 5 % of C, and P(one such event in 30 days).
# 4. The objective, per 30 days at R = 0.40: U(lambda) = E[P&L] - E[jump loss] - lambda x E[loss from single events >= 5 %
#    of C], for lambda = 0, 1, 3, against L1.
# 5. The live path's speed: what each f lets one near-certain market hold when its buy fills as fast as live's did, and
#    the month's loss chances from the calibration's per-band loss rates.
# 6. Larger capital: each f at C = $640 / $1,000 / $2,000 against the same C with no limit, "scaled" and "total only".
import gzip, json, math, random, re, sys, bisect
from collections import defaultdict

def load(f):
    try: return json.load(open(f))
    except FileNotFoundError: return json.load(gzip.open(f + '.gz'))
CELLS = ('rw', 'rw_atprice', 'pr', 'pr_atprice')
X = {k: load(f'results/explim_{k}.json') for k in CELLS}
EX = {k: load(f'results/exp_{k}.json') for k in CELLS}

print('== 1. the copy reproduces EXPENSIVE-SIDE (day changes in total, rewards and stress, exact float equality)')
def same(a, b): return len(a) == len(b) and all(x['day'] == y['day'] and x['tot'] == y['tot'] and x['rew'] == y['rew'] and x['str'] == y['str'] for x, y in zip(a, b))
ok = True
for k in CELLS:
    for arm in ('L1', 'usd 50 mark 0.95'):
        s = same(X[k][arm]['daily'], EX[k][arm]['daily']); ok &= s
        print(f"   {k:11} {arm:17} vs exp_{k}.json: {'identical' if s else 'DIFFERENT'}")
print(f'   all identical: {ok}')

# ---- the jump model, as exp_calib.py builds it
D = sys.argv[1]
MK = {}
for l in open(f'{D}/markets.jsonl'):
    m = json.loads(l); MK[m['cond']] = m
BANDS = [(0.90, 0.95), (0.95, 0.97), (0.97, 0.99), (0.99, 1.0001)]
def band(p):
    for lo, hi in BANDS:
        if lo - 1e-9 <= p < hi: return f'{lo:.2f}-{min(hi, 1):.2f}'
    return None
S = []
seen = set()
for l in open(f'{D}/hist.jsonl'):
    h = json.loads(l)
    m = MK.get(h['cond'])
    if h['cond'] in seen or not m or not h['h'] or len(h['h']) < 24: continue
    seen.add(h['cond'])
    T = [x[0] for x in h['h']]; P = [x[1] for x in h['h']]; close = h['close']
    def at(t, fy):
        if t >= close: return 1.0 if fy == m['yes_won'] else 0.0
        i = bisect.bisect_left(T, t)
        if i >= len(T) or T[i] > t + 7200: return None
        return P[i] if fy else 1 - P[i]
    for t, p in zip(T, P):
        if t > close - 3600: continue
        fy = p >= 0.5; pf = p if fy else 1 - p
        b = band(pf)
        if b is None: continue
        S.append((h['cond'], b, pf, fy != m['yes_won'], (close - t) / 86400, at(t + 3600, fy), at(t + 86400, fy)))
J, LOST, DRIFT = {}, {}, {}
for lo, hi in BANDS:
    b = f'{lo:.2f}-{min(hi, 1):.2f}'
    rows = [s for s in S if s[1] == b and s[5] is not None and s[6] is not None]
    js = [s for s in rows if s[5] <= s[2] - 0.25]
    J[b] = (len(js) / len(rows), sorted(max(0.0, (s[2] - s[6]) / s[2]) for s in js))
    allb = [s for s in S if s[1] == b and s[4] >= 3]
    LOST[b] = sum(s[3] for s in allb) / len(allb)
    DRIFT[b] = sum((s[6] - s[2]) / s[2] for s in rows) / len(rows) / 1.0   # mean 24 h change of the favourite's value, a share of it
print(f"\n   jump model: {len(S)} favourite-hours at >= 0.90; " + '; '.join(f"{b} q {100 * J[b][0]:.3f} %/h, {len(J[b][1])} jumps" for b in J))
print('   loss rate of a favourite with 3-14 days left (pooled hours): ' + ', '.join(f'{b} {100 * LOST[b]:.2f} %' for b in LOST))
print('   mean 24 h drift of its value: ' + ', '.join(f'{b} {100 * DRIFT[b]:+.3f} %/day' for b in DRIFT))

def tail(hs, days, C):
    """E jump loss / 30 d; E loss / 30 d from single events >= 5 % of C; P(>= 1 event >= 5 % / 10 % of C in 30 d)."""
    el = big = l5 = l10 = 0.0
    for c, t, p, H in hs:
        q, rs = J[band(p)]
        if not rs: continue
        el += q * H * sum(rs) / len(rs)
        big += q * sum(r * H for r in rs if r * H >= 0.05 * C) / len(rs)
        l5 += q * sum(1 for r in rs if r * H >= 0.05 * C) / len(rs)
        l10 += q * sum(1 for r in rs if r * H >= 0.10 * C) / len(rs)
    k = 30 / days
    return k * el, k * big, 1 - math.exp(-k * l5), 1 - math.exp(-k * l10)

def fig(o, R=0.4): return [d['tot'] - (1 - R) * d['rew'] for d in o['daily']]
def boot(Dd, seed=20261023, B=2000):
    r = random.Random(seed); s = sorted(sum(r.choice(Dd) for _ in range(len(Dd))) for _ in range(B)); return s[int(0.05 * B)], sum(1 for x in s if x > 0) / B
def one50(o): return sum(n for kk, n in o['expo']['hist'].items() if int(kk.split('|')[1]) >= 50)

FR = [0.03, 0.045, 0.0625, 0.08, 0.1, 0.125, 0.15, 0.2, 0.25]
TH = ['0.93', '0.95', '0.97']
def arm(f, t): return f'f {f} {t}'
print('\n== 2./3. each f x thr at C = $320 against L1, R = 0.40 (diff = arm less L1 over the record; boot = index 100 of 2,000 paired day')
print('   draws, P = share > 0; one = the largest one-market holding at the mark in tokens >= 0.90, one>=50 = minutes with >= $50 of it;')
print('   tail per 30 days from the jump model: E jump = expected jump loss, E big = expected loss from single events >= $16 (5 % of C),')
print('   P5 / P10 = chance of one event >= 5 % / 10 % of C)')
W = {}
for k in CELLS:
    base = X[k]['L1']; b = fig(base); days = base['expo']['minutes'] / 1440
    print(f"\n   -- {k} ({days:.2f} days): L1 total {sum(b):.2f}, reward {base['end']['reward']:.2f}, one {base['expo']['maxOne90']:.2f}, one>=50 {one50(base)}")
    print(f"   {'arm':16} {'$ limit':>7} | {'diff':>7} {'boot100':>8} {'P>0':>5} | {'one':>7} {'one>=50':>7} | {'E jump':>7} {'E big':>7} {'P5':>6} {'P10':>6}")
    t0 = tail(base['expo']['hourly'], days, 320)
    print(f"   {'L1':16} {'-':>7} | {0:+7.2f} {0:+8.2f} {'':>5} | {base['expo']['maxOne90']:7.2f} {one50(base):7d} | {t0[0]:7.2f} {t0[1]:7.2f} {100 * t0[2]:5.2f}% {100 * t0[3]:5.2f}%")
    W[k] = {'L1': (0.0, t0, days, sum(b))}
    for t in TH:
        for f in FR:
            o = X[k][arm(f, t)]; a = fig(o); d = [x - y for x, y in zip(a, b)]
            p5, pos = boot(d); tl = tail(o['expo']['hourly'], days, 320)
            W[k][arm(f, t)] = (sum(d), tl, days, sum(a))
            print(f"   {arm(f, t):16} {f * 320:7.2f} | {sum(d):+7.2f} {p5:+8.2f} {pos:5.2f} | {o['expo']['maxOne90']:7.2f} {one50(o):7d} | {tl[0]:7.2f} {tl[1]:7.2f} {100 * tl[2]:5.2f}% {100 * tl[3]:5.2f}%")
        print()
    for f in (0.0625, 0.1, 0.125):
        o = X[k][f'fcost {f} 0.95']; a = fig(o); d = [x - y for x, y in zip(a, b)]; p5, pos = boot(d)
        print(f"   {'fcost ' + str(f) + ' 0.95':16} {f * 320:7.2f} | {sum(d):+7.2f} {p5:+8.2f} {pos:5.2f} | {o['expo']['maxOne90']:7.2f} {one50(o):7d} |   (at cost, not the mark)")

print('\n== 4. the objective per 30 days, R = 0.40, C = $320: U(lambda) = E[P&L] - E[jump loss] - lambda x E[loss from single events >= 5 % of C],')
print('   each arm less L1; the four cells, then their mean (RW 14 days and the full universe 4 days weighted alike)')
print(f"   {'arm':16} | " + ' | '.join(f'{k:>23}' for k in CELLS) + ' | mean U0     U1     U3')
print(f"   {'':16} | " + ' | '.join(f"{'U0':>7} {'U1':>7} {'U3':>7}" for _ in CELLS) + ' |')
for t in TH:
    for f in FR:
        row, us = [], []
        for k in CELLS:
            dd, tl, days, _ = W[k][arm(f, t)]; _, t0, _, _ = W[k]['L1']
            k30 = 30 / days
            u = [k30 * dd - (tl[0] - t0[0]) - lam * (tl[1] - t0[1]) for lam in (0, 1, 3)]
            us.append(u); row.append(' '.join(f'{x:+7.2f}' for x in u))
        mean = [sum(u[i] for u in us) / len(us) for i in range(3)]
        print(f"   {arm(f, t):16} | " + ' | '.join(row) + ' | ' + ' '.join(f'{x:+6.2f}' for x in mean))
    print()

print('== 5. at the live path\'s speed: one near-certain market whose expensive buy fills whenever it rests (live, 10-09: 101.34 NO at')
print('   0.955-0.972 in 13 h on one market, 80 of them in 21 minutes), held to the limit for the 7 days before it closes; the most it')
print('   can hold is the limit, 5N x p and the $100 market cap, whichever is least (N = 20, p = 0.97). Loss chance per 7-day holding:')
print('   the calibration\'s pooled rate for its band with 3-14 days left. A month = four such holdings in a row.')
LIVE = {}
for C in (320, 640, 1000, 2000):
    print(f'   C = ${C}:')
    for f in [None] + FR:
        lim = 1e9 if f is None else f * C
        # holding + order <= limit; orders of N = 20 at 0.97; so the holding is the largest multiple of 20 x 0.97 that leaves room for none more
        n = 0
        while n < 100 and (n + 20) * 0.97 <= lim + 1e-9: n += 20
        H = min(n * 0.97, 100 * C / 320)
        pl = LOST['0.97-0.99']
        pm = 1 - (1 - pl) ** 4
        lbl = 'no limit' if f is None else f'f {f}'
        LIVE[(C, f)] = (4 * pl * min(lim, 97.0, 100 * C / 320), min(lim, 97.0, 100 * C / 320))
        print(f'     {lbl:10} limit ${lim if f is not None else float("inf"):8.2f}: holds ${H:6.2f} ({100 * H / C:5.2f} % of C); a month: P(a loss) {100 * pm:4.1f} %, E loss ${4 * pl * H:5.2f}'
              f' (drift {30 * DRIFT["0.97-0.99"] * H:+5.2f}), the loss if it comes {100 * H / C:5.2f} % of C, {100 * H / 75 * 320 / C:5.1f} % of the stop\'s room')

print('\n== 6. larger capital (threshold 0.95): each f against the same C with no limit; scaled = the market cap, budget, market count and')
print('   stop grow with C; total = the total cap alone grows. diff at R = 0.40 over the record; tail as in 3 with C the account\'s capital')
for k in CELLS:
    print(f'   -- {k}')
    for C in (640, 1000, 2000):
        for how in ('scaled', 'total'):
            base = X[k][f'C{C} {how} base']; b = fig(base); days = base['expo']['minutes'] / 1440
            t0 = tail(base['expo']['hourly'], days, C)
            line = f"   C {C:5d} {how:6} base total {sum(b):8.2f} one {base['expo']['maxOne90']:6.2f} P5 {100 * t0[2]:5.2f}% |"
            for f in (0.03, 0.0625, 0.08, 0.1, 0.125, 0.2):
                o = X[k][f'C{C} {how} f {f} 0.95']; a = fig(o); d = [x - y for x, y in zip(a, b)]
                tl = tail(o['expo']['hourly'], days, C)
                line += f" f {f}: {sum(d):+6.2f} one {o['expo']['maxOne90']:6.2f} P5 {100 * tl[2]:4.2f}% |"
            print(line)

print('\n== 7. the choice. Objective per 30 days at C = $320, R = 0.40, each f against L1 (no limit):')
print('   U(lambda) = E[P&L] - (1 + lambda) x E[near-certain loss at the live speed] - lambda x E[loss from single events >= 5 % of C on the')
print('   simulated holdings], where E[P&L] is the mean over five records: the four simulated cells (section 2) and live-prep\'s paper,')
print('   replayed to first order (results/explim_paper.json: the formula reward of the minutes the limit would have stopped, x 0.40);')
print('   the live-speed term holds the most the limit allows (f x C, at most 5N x 0.97 = $97 or the $100 market cap) four 7-day')
print('   holdings a month at the calibration\'s pooled loss rate for 0.97-0.99 with 3-14 days left (section 5). lambda = 1 counts a')
print('   dollar lost in one hit twice: as the loss, and as the room it uses of the -$75 total stop that halts the whole path.')
PAPER = load('results/explim_paper.json')
pdays = PAPER['days']
def paper_u(f, t):
    r = next(x for x in PAPER['rows'] if abs(x['f'] - f) < 1e-9 and abs(x['thr'] - float(t)) < 1e-9)
    return -0.4 * r['reward_lost_formula'] * 30 / pdays
pl = LOST['0.97-0.99']
def live_e(lim): return 4 * pl * min(lim, 97.0, 100.0)
_by = defaultdict(list)
for s_ in S:
    if 0.97 <= s_[2] < 0.99 and s_[4] >= 3: _by[s_[0]].append(s_[3])
PERMK = sum(sum(v) / len(v) for v in _by.values()) / len(_by)
best = {}
print(f"   {'arm':16} | {'sim mean':>8} {'paper':>7} {'E[P&L]':>7} | {'live H':>6} {'live E':>6} | {'U0':>7} {'U1':>7} {'U3':>7}")
for t in TH:
    for f in FR:
        u = []
        for lam in (0, 1, 3):
            sims = []
            for k in CELLS:
                dd, tl, days, _ = W[k][arm(f, t)]; _, t0, _, _ = W[k]['L1']
                sims.append(30 / days * dd - lam * (tl[1] - t0[1]))
            pp = paper_u(f, t)
            e = (sum(sims) + pp) / 5
            u.append(e - (1 + lam) * (live_e(f * 320) - live_e(1e9)))
            if lam == 0: sm, pv, ee = sum(sims) / 4, pp, e
        for i, lam in enumerate((0, 1, 3)):
            if lam not in best or u[i] > best[lam][0]: best[lam] = (u[i], arm(f, t))
        print(f"   {arm(f, t):16} | {sm:+8.2f} {pv:+7.2f} {ee:+7.2f} | {min(f * 320, 97):6.2f} {live_e(f * 320):6.2f} | {u[0]:+7.2f} {u[1]:+7.2f} {u[2]:+7.2f}")
    print()
print(f"   L1: live H 97.00, live E {live_e(1e9):.2f} a month")
for lam in (0, 1, 3): print(f"   best at lambda = {lam}: {best[lam][1]} ({best[lam][0]:+.2f} a month against L1)")

# the same with each market weighted once (the calibration's per-market loss rate), the heavier tail
print(f"\n   sensitivity: the live-speed loss rate per 7-day holding {100 * pl:.2f} % (pooled hours) -> {100 * PERMK:.2f} % (each market once):")
for rate in (pl, PERMK):
    bb = {}
    for t in TH:
        for f in FR:
            for lam in (0, 1, 3):
                sims = []
                for k in CELLS:
                    dd, tl, days, _ = W[k][arm(f, t)]; _, t0, _, _ = W[k]['L1']
                    sims.append(30 / days * dd - lam * (tl[1] - t0[1]))
                e = (sum(sims) + paper_u(f, t)) / 5
                u = e - (1 + lam) * 4 * rate * (min(f * 320, 97.0) - 97.0)
                if lam not in bb or u > bb[lam][0]: bb[lam] = (u, arm(f, t))
    print(f"   rate {100 * rate:.2f} %: " + '; '.join(f"lambda {lam}: {bb[lam][1]} ({bb[lam][0]:+.2f})" for lam in (0, 1, 3)))

# the rule: the f whose largest shortfall from the best arm, over the loss-rate estimates (pooled, events-only 0.95-0.99 with
# 3-14 days left = exp_calib.py's 2.70 %, per market) and lambda in {0, 1, 3}, is smallest (minimax regret): neither the
# weight on a single hit nor the tail's true rate is known, so the choice must not depend on either.
_ev = [s_ for s_ in S if 0.95 <= s_[2] < 0.99 and s_[4] >= 3]
RATES = {'pool.97-.99': pl, 'mkt.97-.99': PERMK, 'pool.95-.99': sum(x[3] for x in _ev) / len(_ev)}
U = {}
for rn, rate in RATES.items():
    for lam in (0, 1, 3):
        for t in TH:
            for f in FR:
                sims = []
                for k in CELLS:
                    dd, tl, days, _ = W[k][arm(f, t)]; _, t0, _, _ = W[k]['L1']
                    sims.append(30 / days * dd - lam * (tl[1] - t0[1]))
                U[(rn, lam, arm(f, t))] = (sum(sims) + paper_u(f, t)) / 5 - (1 + lam) * 4 * rate * (min(f * 320, 97.0) - 97.0)
scen = sorted({(rn, lam) for rn, lam, _ in U})
arms_ = [arm(f, t) for t in TH for f in FR]
print('\n   minimax regret: each arm\'s shortfall from the best arm of each scenario (loss rate x lambda), $ a month; the largest of them')
print(f"   {'arm':16} | " + ' '.join(f'{rn + "/" + str(lam):>13}' for rn, lam in scen) + ' |   max')
reg = {}
for a in arms_:
    r = [max(U[(rn, lam, b)] for b in arms_) - U[(rn, lam, a)] for rn, lam in scen]
    reg[a] = max(r)
    print(f"   {a:16} | " + ' '.join(f'{x:13.2f}' for x in r) + f' | {max(r):6.2f}')
print('   rates: ' + ', '.join(f'{k} {100 * v:.2f} %' for k, v in RATES.items()))
ch = min(reg, key=reg.get)
print(f"   chosen (smallest largest regret): {ch}, at most {reg[ch]:.2f} a month short of the best arm in any scenario")
