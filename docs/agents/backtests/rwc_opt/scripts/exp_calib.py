# EXPENSIVE-SIDE (2026-10-09): how often a side priced >= 0.90 loses on Polymarket, and what that means for live-prep's
# holdings. python3 -I scripts/exp_calib.py <dir of exp_calib_fetch.py's markets.jsonl / hist.jsonl>  (from this folder;
# also reads results/exp_*.json for the simulated holdings)
# 1. Calibration: every hourly price of a resolved market's favourite (the side at >= 0.5) at >= 0.90, from 14 days
#    before the market closed to an hour before, by price band: the share of those hours whose favourite went on to lose
#    (pooled hours, and each market weighted once), against what the price implies (the mean of 1 - p), with a 90 %
#    interval from a market-cluster bootstrap (random.Random(20261023), 1,000 draws); the same by days left and by class.
# 2. Jumps: the chance in one hour that the favourite falls by >= 25 c (the move a resting quote cannot get out of), and
#    what it is worth 24 hours later (the payout if it closed first).
# 3. The tail of the simulated holdings: every hourly sample of a market's holding in a token marked >= 0.90 (exp_run.ts's
#    `hourly`: held $ at the mark H, the token's price p) meets that band's hourly jump chance q and, given a jump, the
#    empirical share of value lost 24 hours later r: expected jump loss sum(q x H x E[r]); the chance of one loss >= $50
#    in 30 days, 1 - exp(-(30 / days) x sum(q x P(r >= 50 / H))).
import json, math, random, re, sys, bisect
from collections import defaultdict
D = sys.argv[1]
MK = {}
for l in open(f'{D}/markets.jsonl'):
    m = json.loads(l); MK[m['cond']] = m
PRICE = re.compile(r'bitcoin|\bbtc\b|ethereum|\beth\b|solana|\bxrp\b|\bbnb\b|doge|hyperliquid|price of|\$\d|dip to|reach \$|close (above|below)|(above|below) \$|earnings|nasdaq|s&p|\bstock|market cap|fdv|\(\w{1,5}\)', re.I)
MENT = re.compile(r'\bsay\b|\bsays\b|\bpost\b|\bposts\b|tweet|truth social|mention', re.I)
def cls(q): return 'prices' if PRICE.search(q) else 'say/post' if MENT.search(q) else 'events'
BANDS = [(0.90, 0.95), (0.95, 0.97), (0.97, 0.99), (0.99, 1.0001)]
def band(p):
    for lo, hi in BANDS:
        if lo - 1e-9 <= p < hi: return f'{lo:.2f}-{min(hi, 1):.2f}'
    return None
S = []   # (cond, band, p, lost, daysleft, cls, p1h, p24h)
nm = nh = 0
seen = set()   # a market whose end is exactly 00:00 UTC is listed on two days: read it once
for l in open(f'{D}/hist.jsonl'):
    h = json.loads(l)
    m = MK.get(h['cond'])
    if h['cond'] in seen or not m or not h['h'] or len(h['h']) < 24: continue
    seen.add(h['cond'])
    nm += 1
    T = [x[0] for x in h['h']]; P = [x[1] for x in h['h']]; close = h['close']
    def at(t, fav_yes):
        if t >= close: return 1.0 if fav_yes == m['yes_won'] else 0.0
        i = bisect.bisect_left(T, t)
        if i >= len(T) or T[i] > t + 7200: return None
        return P[i] if fav_yes else 1 - P[i]
    c = cls(m['q'])
    for t, p in zip(T, P):
        if t > close - 3600: continue
        fy = p >= 0.5; pf = p if fy else 1 - p
        b = band(pf)
        if b is None: continue
        nh += 1
        S.append((h['cond'], b, pf, fy != m['yes_won'], (close - t) / 86400, c, at(t + 3600, fy), at(t + 86400, fy)))
print(f'== Polymarket calibration: {len(MK)} distinct markets drawn, {nm} with an hourly history; {len(S)} favourite-hours at >= 0.90 in {len({s[0] for s in S})} markets')
cnt = defaultdict(int)
for m in MK.values(): cnt[cls(m['q'])] += 1
print('   classes drawn: ' + ', '.join(f'{k} {v}' for k, v in sorted(cnt.items())))
def stats(rows):
    if not rows: return None
    by = defaultdict(list)
    for r in rows: by[r[0]].append(r)
    conds = list(by)
    pooled = sum(r[3] for r in rows) / len(rows)
    implied = sum(1 - r[2] for r in rows) / len(rows)
    permk = sum(sum(r[3] for r in v) / len(v) for v in by.values()) / len(conds)
    lostm = sum(1 for v in by.values() if v[0][3])
    rr = random.Random(20261023); bs = []
    for _ in range(1000):
        n = l = 0
        for c in (rr.choice(conds) for _ in conds):
            v = by[c]; n += len(v); l += sum(r[3] for r in v)
        bs.append(l / n)
    bs.sort()
    j = [r for r in rows if r[6] is not None]
    jump = sum(1 for r in j if r[6] <= r[2] - 0.25) / len(j) if j else float('nan')
    return dict(n=len(rows), m=len(conds), lostm=lostm, pooled=pooled, implied=implied, permk=permk, lo=bs[50], hi=bs[949], jump=jump, nj=len(j))
def line(lbl, s):
    if not s: return f'   {lbl:28} (none)'
    return (f"   {lbl:28} {s['n']:7d} {s['m']:5d} {s['lostm']:5d} | {100 * s['implied']:6.2f} {100 * s['pooled']:6.2f} [{100 * s['lo']:5.2f}, {100 * s['hi']:5.2f}] {100 * s['permk']:6.2f}"
            f" | {100 * s['jump']:7.3f}")
HDR = f"   {'':28} {'hours':>7} {'mkts':>5} {'lost':>5} | {'impl %':>6} {'lost %':>6} {'90 % (cluster)':>16} {'per-mkt':>6} | {'jump/h %':>8}"
print('   (impl % = mean 1 - p, what the price says; lost % = the share of favourite-hours whose side lost, pooled; per-mkt = each')
print('    market weighted once; lost = markets whose favourite lost; jump/h = hours after which the favourite was >= 25 c lower)')
print(HDR)
for lo, hi in BANDS:
    b = f'{lo:.2f}-{min(hi, 1):.2f}'
    print(line(f'band {b}', stats([s for s in S if s[1] == b])))
print(line('all >= 0.90', stats(S)))
print(line('all >= 0.95', stats([s for s in S if s[2] >= 0.95])))
print('\n   by days left to close (>= 0.95 | 0.90-0.95):')
print(HDR)
for a, z in ((0, 1), (1, 3), (3, 7), (7, 14.1)):
    print(line(f'>= .95, {a}-{z:g} d', stats([s for s in S if s[2] >= 0.95 and a <= s[4] < z])))
    print(line(f'.90-.95, {a}-{z:g} d', stats([s for s in S if s[2] < 0.95 and a <= s[4] < z])))
print('\n   by class (>= 0.95, 1-14 days left | 0.95-0.99, 3-14 days left, the Iran position\'s case):')
print(HDR)
for c in ('events', 'say/post', 'prices'):
    print(line(f'{c}, >= .95, 1-14 d', stats([s for s in S if s[5] == c and s[2] >= 0.95 and s[4] >= 1])))
    print(line(f'{c}, .95-.99, 3-14 d', stats([s for s in S if s[5] == c and 0.95 <= s[2] < 0.99 and s[4] >= 3])))
print(line('all, .95-.99, 3-14 d', stats([s for s in S if 0.95 <= s[2] < 0.99 and s[4] >= 3])))
print(line('all, .97-.99, 3-14 d', stats([s for s in S if 0.97 <= s[2] < 0.99 and s[4] >= 3])))

# jumps and what is lost 24 hours later, by band
print('\n== jumps: per band, hours with a next-hour price; jump = the favourite >= 25 c lower an hour later; r = the share of the')
print('   price at the jump lost 24 hours later (the payout if the market closed first); drift = mean (p24 - p) / p over all hours')
J = {}
for lo, hi in BANDS:
    b = f'{lo:.2f}-{min(hi, 1):.2f}'
    rows = [s for s in S if s[1] == b and s[6] is not None and s[7] is not None]
    js = [s for s in rows if s[6] <= s[2] - 0.25]
    rs = sorted(max(0.0, (s[2] - s[7]) / s[2]) for s in js)
    q = len(js) / len(rows) if rows else 0
    drift = sum((s[7] - s[2]) / s[2] for s in rows) / len(rows) if rows else 0
    down = sum(max(0, s[2] - s[7]) / s[2] for s in rows) / len(rows) if rows else 0
    J[b] = (q, rs)
    print(f"   {b}: {len(rows)} hours, {len(js)} jumps (q = {100 * q:.3f} % an hour, {100 * (1 - (1 - q) ** 24):.2f} % a day), r median {rs[len(rs) // 2] if rs else float('nan'):.2f}, mean {sum(rs) / len(rs) if rs else float('nan'):.2f};"
          f" 24 h drift {100 * drift:+.3f} %, mean 24 h downside {100 * down:.3f} % of value")

# the simulated holdings' tail
def bandkey(p):
    return band(p)
print('\n== the tail of the simulated holdings (hourly samples of each market holding a token marked >= 0.90), 30-day view')
print(f"   {'record':11} {'arm':18} {'hours':>6} {'$-hours':>9} {'max H':>7} | {'E jump loss $/30d':>17} {'P(>= $50 in 30d)':>17} {'P(>= $25)':>9}")
for rec in ('rw', 'rw_atprice', 'pr', 'pr_atprice'):
    try: E = json.load(open(f'results/exp_{rec}.json'))
    except FileNotFoundError:
        import gzip; E = json.load(gzip.open(f'results/exp_{rec}.json.gz'))
    days = E['L1']['expo']['minutes'] / 1440
    for arm in ('L1', 'nobuy 0.95', 'inv 1N 0.95', 'inv 2N 0.95', 'usd 25 0.95', 'usd 50 0.95', 'nobuy 0.90', 'inv 1N 0.90', 'usd 25 0.90', 'usd 50 0.90'):
        hs = E[arm]['expo']['hourly']
        el = l50 = l25 = 0.0
        for c, t, p, H in hs:
            q, rs = J[bandkey(p)]
            if not rs: continue
            el += q * H * sum(rs) / len(rs)
            l50 += q * sum(1 for r in rs if r * H >= 50) / len(rs)
            l25 += q * sum(1 for r in rs if r * H >= 25) / len(rs)
        k = 30 / days
        print(f"   {rec:11} {arm:18} {len(hs):6d} {sum(x[3] for x in hs):9.0f} {max((x[3] for x in hs), default=0):7.2f} | {k * el:17.2f} {100 * (1 - math.exp(-k * l50)):16.2f}% {100 * (1 - math.exp(-k * l25)):8.2f}%")
# a position like the live one: H dollars at p held for d days
print('\n== a position like the live one (80 NO at ~0.97, $77.7 at cost), held without a jump-exit, by days held:')
q, rs = J['0.97-0.99']
for H in (77.7, 50, 25, 19.4):
    for d in (1, 3, 7):
        lam = 24 * d * q * sum(1 for r in rs if r * H >= 50) / len(rs)
        e = 24 * d * q * H * sum(rs) / len(rs)
        print(f"   H ${H:5.1f}, {d} d: E jump loss ${e:5.2f}, P(loss >= $50) {100 * (1 - math.exp(-lam)):5.2f} %")

# the same position held all month: a fresh one each week (the live market's last 7 days), its loss chance from the
# calibration (0.97-0.99, 3-14 days left, pooled and per market) and from the jump model; and the 24 h drift's cost
print('\n== one such position kept all month (four 7-day holdings in a row; the calibration rows read a 0.97-0.99 favourite with 3-14 days left):')
st = stats([s for s in S if 0.97 <= s[2] < 0.99 and s[4] >= 3])
for lbl, pl in (('calibration, pooled hours', st['pooled']), ('calibration, per market', st['permk']), ('price-implied (YES at 0.03)', 0.03)):
    print(f"   {lbl:30}: P(a 7-day holding loses before close) {100 * pl:.2f} % -> P(>= 1 loss in a month) {100 * (1 - (1 - pl) ** 4):.1f} %; E loss ${77.7 * pl * 4:.2f} a month")
lam = 24 * q * sum(1 for r in rs if r * 77.7 >= 50) / len(rs)
print(f"   {'jump model':30}: P(>= $50 in 30 d) {100 * (1 - math.exp(-30 * lam)):.1f} %; E jump loss ${30 * 24 * q * 77.7 * sum(rs) / len(rs):.2f} a month")
for H in (50, 25):
    lam = 24 * q * sum(1 for r in rs if r * H >= 50) / len(rs)
    print(f"   {'jump model, H $' + str(H):30}: P(>= $50 in 30 d) {100 * (1 - math.exp(-30 * lam)):.1f} %; E jump loss ${30 * 24 * q * H * sum(rs) / len(rs):.2f} a month; worst single loss ${H}")
