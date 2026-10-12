# LP-ADVERSE: live against paper. Markouts of the paper fills (live-prep's paper layer 10-04 -> 10-09, RW-C 10-08 ->) on
# the same mid source as the live fills (pm-rec's book), the fill rate per quoted market-minute, and the reward formula
# a day, so the gap between what paper showed and what live did can be split into its causes.
#   LPADV_WORK=<scratch> python3 -I docs/agents/backtests/lpadverse/scripts/paper_vs_live.py > docs/agents/backtests/lpadverse/results/paper_vs_live.txt
import sys, os, pickle, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

P = jload('paper.json')
tg = jload('targets.json')['ids']
cond_of_id = {r[0]: r[1] for r in tg}
qof = {r[1]: r[3] for r in tg}
rb = pickle.load(open(os.path.join(WORK, 'books.pkl'), 'rb'))
mids = Mids([], rb['books'], cond_of_id)          # the recorder's book only, for paper and live alike
live = pickle.load(open(os.path.join(WORK, 'fills2.pkl'), 'rb'))
aux = jload('live_aux.json')
lm = []
for d in ('1009', '1010', '1011', '1012'): lm.extend(jload(f'lm_{d}.json.gz')['rows'])
rwc = []
for d in ('1008', '1009', '1010', '1011', '1012'): rwc.extend(jload(f'rwc_{d}.json.gz')['rows'])
lpp = []
for d in ('a', 'b', 'c'): lpp.extend(jload(f'lpp_{d}.json.gz')['rows'])

HZ = [('fill', 0), ('5m', 300), ('60m', 3600), ('6h', 21600)]
def mark(rows):
    for r in rows:
        k, v = mids.at(r['cond'], r['t'] - 5, tol=600, after=False)
        r['m_fill'] = Mids.midof(v)
        for name, h in HZ[1:]:
            r['m_' + name] = mids.mid(r['cond'], r['t'] + h, tol=max(600, h // 4))
        for name, _ in HZ:
            m = r['m_' + name]
            r['mo_' + name] = None if m is None else r['d'] * (m - r['y']) * r['size']
    return rows

def summary(lab, rows, mk=lambda r: (r['cond'], day_of(r['t']))):
    sh = sum(r['size'] for r in rows)
    cells = []
    for name, _ in HZ:
        xs = [r for r in rows if r['mo_' + name] is not None]
        s = sum(r['mo_' + name] for r in xs); ssh = sum(r['size'] for r in xs)
        cells.append(f"{s:>9.2f} ({100 * s / ssh if ssh else 0:>6.2f})")
    g = {}
    for r in rows:
        if r['mo_60m'] is not None: g.setdefault(mk(r), []).append(r)
    ci = ''
    if len(g) >= 3:
        lo, md, hi = bootstrap(g, lambda d: 100 * sum(r['mo_60m'] for r in d) / max(1e-9, sum(r['size'] for r in d)), n=2000)
        ci = f" [{lo:>6.2f}, {hi:>6.2f}] c/sh 60m"
    print(f"{lab:<44}{len(rows):>6}{sh:>9.0f} " + ' '.join(cells) + ci)

# Paper fills, YES-equivalent: a paper 'bid' fill bought YES at its price (d = +1), an 'ask' fill sold YES (d = -1).
lppf = [{'cond': c, 't': float(ts), 'side': s, 'd': 1 if s == 'bid' else -1, 'y': float(p), 'size': float(z), 'close_only': co}
        for c, mi, ts, s, p, z, tside, tpx, co in P['lpprep_fills']]
rwcf = [{'cond': c, 't': float(ts), 'side': s, 'd': 1 if s == 'bid' else -1, 'y': float(p), 'size': float(z)} for c, mi, ts, s, p, z in P['rwc_fills']]
mark(lppf); mark(rwcf)
for r in live:
    r['t2'] = r['t']
mark(live)

GO = ep('2026-10-09T01:32:00+00:00')
live_conds = {r[1] for r in lm}
print("LP-ADVERSE: paper against live. Markouts at the recorder's mid (pm-rec, the venue's book) for every path, so the")
print("three are on one footing; cells $ (cents a share), positive = the fill earned; range: 60-minute c/sh, market-day bootstrap.")
print(f"{'':<44}{'fills':>6}{'shares':>9} " + ' '.join(f"{('mo_' + h + ' $ (c/sh)'):>18}" for h, _ in HZ))
summary('live-prep LIVE, every fill', live)
summary('live-prep LIVE, BUYs (entries)', [r for r in live if r['side'] == 'BUY'])
summary('live-prep paper layer (dry-run 10-04 -> go)', lppf)
summary('live-prep paper layer, not close-only', [r for r in lppf if not r['close_only']])
summary('RW-C paper, before the go', [r for r in rwcf if r['t'] < GO])
summary('RW-C paper, after the go', [r for r in rwcf if r['t'] >= GO])
summary('RW-C paper, after the go, live-prep\'s markets', [r for r in rwcf if r['t'] >= GO and r['cond'] in live_conds])
summary('RW-C paper, after the go, other markets', [r for r in rwcf if r['t'] >= GO and r['cond'] not in live_conds])
print('\nBy YES direction (d = +1 bought YES / sold NO; d = -1 sold YES / bought NO):')
for lab, rs in (('live', live), ('lpprep paper', lppf), ('RW-C paper', rwcf)):
    for dd in (1, -1):
        summary(f'{lab}, d = {dd:+d}', [r for r in rs if r['d'] == dd])

# Fill rates: fills (and shares) per quoted market-minute, and per formula dollar.
print('\n== How often a quote is filled, and what the formula paid a day')
lq = [r for r in lm if (r[6] is not None or r[7] is not None)]
lq2 = [r for r in lm if (r[6] is not None and r[7] is not None)]
live_days = (max(r['t'] for r in live) - GO) / 86400
lf = sum(float(r[12] or 0) for r in lm)
print(f"live: {len(live)} fills, {sum(r['size'] for r in live):.0f} shares over {len(lq)} market-minutes with a quote resting "
      f"({len(lq2)} two-sided); {1000 * len(live) / len(lq):.2f} fills and {sum(r['size'] for r in live) / len(lq):.3f} shares per quoted minute; "
      f"formula over the live minutes ${lf:.2f} in {live_days:.2f} days = ${lf / live_days:.2f}/day")
lpq = [r for r in lpp if r[5] is not None or r[6] is not None]
lppdays = (max(r[0] for r in lpp) - min(r[0] for r in lpp)) / 86400
lpr = sum(float(r[11] or 0) for r in lpp)
print(f"lpprep paper: {len(lppf)} fills, {sum(r['size'] for r in lppf):.0f} shares over {len(lpq)} market-minutes with a quote; "
      f"{1000 * len(lppf) / len(lpq):.2f} fills and {sum(r['size'] for r in lppf) / len(lpq):.3f} shares per quoted minute; formula ${lpr:.2f} in {lppdays:.2f} days = ${lpr / lppdays:.2f}/day")
rq = [r for r in rwc if r[2]]
rwcdays = (max(r[0] for r in rwc) - min(r[0] for r in rwc)) / 86400
rr = sum(float(r[13] or 0) for r in rwc)
print(f"RW-C paper: {len(rwcf)} fills, {sum(r['size'] for r in rwcf):.0f} shares over {len(rq)} quoting market-minutes; "
      f"{1000 * len(rwcf) / len(rq):.2f} fills and {sum(r['size'] for r in rwcf) / len(rq):.3f} shares per quoted minute; formula ${rr:.2f} in {rwcdays:.2f} days = ${rr / rwcdays:.2f}/day")
print('(fills per quoted minute are x 1000)')

# The same markets and minutes: live-prep's live minutes against RW-C's minutes in the same market and minute.
print('\n== The same market and minute, live against RW-C (after the go)')
rwcmin = {(r[1], int(r[0])): r for r in rwc}
both = []
for r in lm:
    k = (r[1], int(r[0]))
    x = rwcmin.get(k)
    if x is None or not x[2]: continue
    lb, la = r[6], r[7]
    both.append((r, x))
print(f"market-minutes both quoted: {len(both)}")
same = sum(1 for r, x in both if r[6] is not None and x[9] is not None and abs(float(r[6]) - float(x[9])) < 1e-9)
print(f"  of which live's bid equals RW-C's b: {same}")
lfm = {}
for f in live: lfm.setdefault((f['cond'], int(f['t'] // 60 * 60)), []).append(f)
rfm = {}
for f in rwcf: rfm.setdefault((f['cond'], int(f['t'] // 60 * 60)), []).append(f)
lfill = sum(len(lfm.get((r[1], int(r[0])), [])) for r, x in both)
rfill = sum(len(rfm.get((x[1], int(x[0])), [])) for r, x in both)
lsh = sum(sum(f['size'] for f in lfm.get((r[1], int(r[0])), [])) for r, x in both)
rsh = sum(sum(f['size'] for f in rfm.get((x[1], int(x[0])), [])) for r, x in both)
lform = sum(float(r[12] or 0) for r, x in both); rform = sum(float(x[13] or 0) for r, x in both)
print(f"  live fills {lfill} ({lsh:.0f} shares), RW-C paper fills {rfill} ({rsh:.0f} shares) in those minutes")
print(f"  formula in those minutes: live ${lform:.2f} (the programme as read each minute, our quotes as they rested), RW-C ${rform:.2f} (RW's)")
# Live fills in those shared minutes: was there a print strictly through the price (the paper's fill test)?
pr = {}
for p in rb['prints']:
    c = cond_of_id.get(p[0])
    if c: pr.setdefault(c, []).append(p)
for c in pr: pr[c].sort(key=lambda p: p[1])
def through(f):
    """A public print strictly through the fill's YES-equivalent price, on the side that fills it, within 60 s of it."""
    ps = pr.get(f['cond']) or []
    ts = [p[1] for p in ps]
    i = bisect.bisect_left(ts, f['t'] - 60)
    for p in ps[i:]:
        if p[1] > f['t'] + 60: break
        ypx = p[4] if p[3] == 0 else 1 - p[4]
        dirn = p[2] if p[3] == 0 else ('SELL' if p[2] == 'BUY' else 'BUY')
        if f['d'] == 1 and dirn == 'SELL' and ypx < f['y'] - 1e-9: return True
        if f['d'] == -1 and dirn == 'BUY' and ypx > f['y'] + 1e-9: return True
    return False
def sweep_through(f):
    """The taker's own trade took a maker at a worse price than ours (it went through our price), YES-equivalent."""
    return (f['sweep_c'] or 0) > 1e-6
nt = sum(1 for f in live if through(f)); ns = sum(1 for f in live if sweep_through(f))
print(f"\nlive fills with a public print strictly through their price within 60 s: {nt} of {len(live)}; whose own taker took more than one price level: {ns}")
summary('live fills the paper test would have filled', [f for f in live if through(f)])
summary('live fills the paper test would NOT have filled', [f for f in live if not through(f)])
summary("live fills whose own taker went past our price", [f for f in live if sweep_through(f)])
summary("live fills whose own taker stopped at our price", [f for f in live if not sweep_through(f)])
both_ = [f for f in live if through(f) and sweep_through(f)]
print(f"both tests: {len(both_)}; paper test only: {nt - len(both_)}; own sweep only: {ns - len(both_)}")
pickle.dump({'lppf': lppf, 'rwcf': rwcf}, open(os.path.join(WORK, 'paper.pkl'), 'wb'))
