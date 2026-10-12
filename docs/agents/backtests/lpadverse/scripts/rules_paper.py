# LP-ADVERSE: the same candidate rules on the paper records, the second and larger sample: RW-C (10-08 -> 10-12, RW's rule
# on RW's universe, paper fills on prints strictly through the quote) and live-prep's paper layer (10-04 -> the go).
#   LPADV_WORK=<scratch> python3 -I docs/agents/backtests/lpadverse/scripts/rules_paper.py > docs/agents/backtests/lpadverse/results/rules_paper.txt
# A paper fill is valued two ways: marked 60 minutes later (the short horizon; less noise from what a paper book would
# have done with its stock) and at the end of the record (the recorder's last mid). The reward is each minute's paper
# formula times k: k = 0.23 is what the live account was paid per dollar of RW-C's formula in the same markets and minutes
# (live formula / RW-C formula 0.305 in the 24,499 shared market-minutes, paper_vs_live.txt, times R 0.75); k = 0.75 is
# the paper's own assumption. A rule that stops quoting a minute loses its formula; one that quotes deeper keeps the share
# of the minute's formula its deeper quotes would score (the others' scores fixed). Deeper quotes fill only on a print
# strictly through the deeper price, at that price (the paper's own fill test).
import sys, os, pickle, bisect, random
from collections import deque
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

P = jload('paper.json')
tg = jload('targets.json')['ids']
cond_of_id = {r[0]: r[1] for r in tg}
meta = {r[1]: {'q': r[3], 'end': ep(r[4]) if r[4] else None} for r in tg}
rb = pickle.load(open(os.path.join(WORK, 'books.pkl'), 'rb'))
mids = Mids([], rb['books'], cond_of_id)
pr = {}
for p in rb['prints']:
    c = cond_of_id.get(p[0])
    if c: pr.setdefault(c, []).append(p)
for c in pr: pr[c].sort(key=lambda p: p[1])
prt = {c: [p[1] for p in ps] for c, ps in pr.items()}
rwc = []
for d in ('1008', '1009', '1010', '1011', '1012'): rwc.extend(jload(f'rwc_{d}.json.gz')['rows'])
lpp = []
for d in ('a', 'b', 'c'): lpp.extend(jload(f'lpp_{d}.json.gz')['rows'])
selp = {(s[0], s[1]): s for s in P['rwc_sel']}
for s in P['rwc_sel']:
    if s[1] in meta and meta[s[1]]['end'] is None and s[8]: meta[s[1]]['end'] = ep(s[8])
for s in P['lp_dry_sel']:
    meta.setdefault(s[1], {'q': s[7], 'end': ep(s[8]) if s[8] else None})

def qt(c): return mtype((meta.get(c) or {}).get('q') or '')
def last_mid(c):
    k, m = mids.last(c)
    return m

ROLL = {}
def range_before(cond, t, win=3600):
    key = (cond, win)
    if key not in ROLL:
        ks = mids.keys.get(cond) or []; out = []; qmax, qmin, pts = deque(), deque(), deque()
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
        ROLL[key] = (ks, out)
    ks, out = ROLL[key]
    i = bisect.bisect_right(ks, int(t)) - 1
    if i < 0 or t - ks[i] > 900: return None
    return out[i]

def run(name, fills, mins, minute_of, k_list=(0.23, 0.75)):
    """fills: dicts with cond, t, d, y, size, tick, minute row; mins: (t, cond, reward, width, v, m, b, a, ours, others, N)."""
    for f in fills:
        f['m60'] = mids.mid(f['cond'], f['t'] + 3600, tol=900)
        f['vend'] = last_mid(f['cond'])
        f['mo60'] = None if f['m60'] is None else f['d'] * (f['m60'] - f['y']) * f['size']
        f['moend'] = None if f['vend'] is None else f['d'] * (f['vend'] - f['y']) * f['size']
        f['md'] = (f['cond'], day_of(f['t']))
    days = (max(m[0] for m in mins) - min(m[0] for m in mins)) / 86400
    mds = sorted({f['md'] for f in fills} | {(m[1], day_of(m[0])) for m in mins})

    def evaluate(keep=None, value=None, frac=None):
        o = {k: [0.0, 0.0, 0.0] for k in mds}
        for f in fills:
            if keep is not None and not keep(f): continue
            v = value(f) if value is not None else (f['mo60'], f['moend'])
            if v is None: continue
            o[f['md']][0] += v[0] or 0.0; o[f['md']][1] += v[1] or 0.0
        for m in mins:
            fr = 1.0 if frac is None else frac(m)
            o[(m[1], day_of(m[0]))][2] += m[2] * fr
        return o
    B = evaluate()
    print(f"\n== {name}: {len(fills)} fills, {len(mins)} quoted market-minutes, {days:.2f} days")
    tot = [sum(v[i] for v in B.values()) for i in range(3)]
    print(f"base: fills marked 60 min {tot[0]:+.2f}, to the end {tot[1]:+.2f}; formula {tot[2]:.2f}; "
          + '; '.join(f"net/day at k {k}: {(tot[0] + k * tot[2]) / days:+.2f} (60 min), {(tot[1] + k * tot[2]) / days:+.2f} (end)" for k in k_list))
    print(f"{'change':<52}{'d fills60':>10}{'d fillsEnd':>11}{'d formula':>10}" + ''.join(f"{'$/day k' + str(k):>13}{'5%':>8}{'95%':>8}" for k in k_list))
    def report(lab, o):
        d = [sum(o[k][i] for k in mds) - sum(B[k][i] for k in mds) for i in range(3)]
        cells = ''
        for k in k_list:
            rnd = random.Random(20261012); res = []
            for _ in range(1000):
                s = 0.0
                for _ in mds:
                    kk = mds[rnd.randrange(len(mds))]
                    s += (o[kk][0] - B[kk][0]) + k * (o[kk][2] - B[kk][2])
                res.append(s / days)
            res.sort()
            cells += f"{(d[0] + k * d[2]) / days:>+13.2f}{res[50]:>+8.2f}{res[950]:>+8.2f}"
        print(f"{lab:<52}{d[0]:>+10.2f}{d[1]:>+11.2f}{d[2]:>+10.2f}{cells}")
    for T in sorted({qt(f['cond']) for f in fills}):
        report(f"type out: {T}", evaluate(keep=lambda f, T=T: qt(f['cond']) != T, frac=lambda m, T=T: 0.0 if qt(m[1]) == T else 1.0))
    Ts = ('view-count', 'statements')
    report("types out: view-count + statements", evaluate(keep=lambda f: qt(f['cond']) not in Ts, frac=lambda m: 0.0 if qt(m[1]) in Ts else 1.0))
    def dl(c, t):
        e = (meta.get(c) or {}).get('end')
        return None if e is None else (e - t) / 86400
    for X in (1, 2, 7):
        report(f"no quote within {X} day(s) of the end", evaluate(keep=lambda f, X=X: (dl(f['cond'], f['t']) is None) or dl(f['cond'], f['t']) >= X,
                                                              frac=lambda m, X=X: 0.0 if (dl(m[1], m[0]) is not None and dl(m[1], m[0]) < X) else 1.0))
    for W in (2, 3, 4):
        report(f"quote only where the touch is {W} c wide or more", evaluate(keep=lambda f, W=W: (f['width'] if f['width'] is not None else 99) >= W - 1e-6,
                                                                          frac=lambda m, W=W: 0.0 if (m[3] is not None and m[3] < W - 1e-6) else 1.0))
    for X in (3, 6, 10):
        report(f"no quote while the mid ranged >= {X} c over the last hour", evaluate(keep=lambda f, X=X: (range_before(f['cond'], f['t']) or 0) < X,
                                                                                   frac=lambda m, X=X: 0.0 if (range_before(m[1], m[0]) or 0) >= X else 1.0))
    if mins and mins[0][4] is not None:
        for kt in (1, 2):
            def value(f, kt=kt):
                lvl = f['y'] - f['d'] * kt * f['tick']
                ok = f['print_y'] is not None and f['d'] * (lvl - f['print_y']) > 1e-9
                if not ok: return None
                adj = kt * f['tick'] * f['size']
                return ((f['mo60'] + adj) if f['mo60'] is not None else None, (f['moend'] + adj) if f['moend'] is not None else None)
            def frac(m, kt=kt):
                t, c, rw, w, v, mm, b, a, ours, others, N, tick = m
                if rw <= 0 or not v or mm is None or b is None or a is None or not ours: return 1.0
                S = lambda s: ((v - s) / v) ** 2 if 0 <= s < v else 0.0
                o1 = min(S(100 * (mm - b) + 100 * kt * tick), S(100 * (a - mm) + 100 * kt * tick)) * N
                f0 = ours / (ours + others); f1 = o1 / (o1 + others) if o1 > 0 else 0.0
                return f1 / f0 if f0 > 0 else 1.0
            report(f"quotes {kt} tick(s) further from the mid", evaluate(value=value, frac=frac))
            if kt == 1:
                okP1 = lambda f: (range_before(f['cond'], f['t']) or 0) < 10 and (f['width'] if f['width'] is not None else 99) >= 3 - 1e-6
                report("P4: P1 + quotes 1 tick further", evaluate(keep=okP1, value=value,
                       frac=lambda m, fr=frac: 0.0 if ((range_before(m[1], m[0]) or 0) >= 10 or (m[3] is not None and m[3] < 3 - 1e-6)) else fr(m)))
            report(f"view-count + statements out, {kt} tick(s) further", evaluate(keep=lambda f: qt(f['cond']) not in Ts, value=value,
                                                                              frac=lambda m, fr=frac: 0.0 if qt(m[1]) in Ts else fr(m)))
    report("P1: no quote after a 10 c hour + touch >= 3 c", evaluate(keep=lambda f: (range_before(f['cond'], f['t']) or 0) < 10 and (f['width'] if f['width'] is not None else 99) >= 3 - 1e-6,
                                                                    frac=lambda m: 0.0 if ((range_before(m[1], m[0]) or 0) >= 10 or (m[3] is not None and m[3] < 3 - 1e-6)) else 1.0))
    report("P2: P1 + view-count and statements out", evaluate(keep=lambda f: qt(f['cond']) not in Ts and (range_before(f['cond'], f['t']) or 0) < 10 and (f['width'] if f['width'] is not None else 99) >= 3 - 1e-6,
                                                             frac=lambda m: 0.0 if (qt(m[1]) in Ts or (range_before(m[1], m[0]) or 0) >= 10 or (m[3] is not None and m[3] < 3 - 1e-6)) else 1.0))
    report("view-count + statements out, touch >= 3 c", evaluate(keep=lambda f: qt(f['cond']) not in Ts and (f['width'] if f['width'] is not None else 99) >= 3 - 1e-6,
                                                                   frac=lambda m: 0.0 if (qt(m[1]) in Ts or (m[3] is not None and m[3] < 3 - 1e-6)) else 1.0))

def print_y(c, t, d):
    """The most extreme YES-equivalent price of a print on the fill's side within 2 s of the paper fill."""
    ps = pr.get(c) or []; ts = prt.get(c) or []
    i = bisect.bisect_left(ts, t - 2); best = None
    for p in ps[i:]:
        if p[1] > t + 2: break
        ypx = p[4] if p[3] == 0 else 1 - p[4]
        dirn = p[2] if p[3] == 0 else ('SELL' if p[2] == 'BUY' else 'BUY')
        if (d == 1 and dirn == 'SELL') or (d == -1 and dirn == 'BUY'):
            if best is None or d * (best - ypx) > 0: best = ypx
    return best

# RW-C
rmin = {(r[1], int(r[0])): r for r in rwc}
fl = []
for c, mi, ts, s, p, z in P['rwc_fills']:
    row = rmin.get((c, int(mi)))
    w = None if (row is None or row[4] is None or row[5] is None) else 100 * (float(row[5]) - float(row[4]))
    tick = float(row[3]) if row is not None and row[3] else 0.01
    d = 1 if s == 'bid' else -1
    fl.append({'cond': c, 't': float(ts), 'd': d, 'y': float(p), 'size': float(z), 'width': w, 'tick': tick, 'print_y': print_y(c, float(ts), d)})
mins = []
for r in rwc:
    if not r[2]: continue
    s = selp.get((day_of(r[0]), r[1]))
    v = float(s[4]) if s else None; N = max(float(s[5]), 5.0) if s else 20.0
    w = None if r[4] is None or r[5] is None else 100 * (float(r[5]) - float(r[4]))
    f = lambda x: None if x is None else float(x)
    mins.append((r[0], r[1], float(r[13] or 0), w, v, f(r[8]), f(r[9]), f(r[10]), f(r[11]) or 0.0, f(r[12]) or 0.0, N, float(r[3] or 0.01)))
print("LP-ADVERSE: candidate rules on the paper records. $/day at k (payout per formula dollar), with a market-day bootstrap (1,000 draws).")
print("A paper fill is a print strictly through the quote: it sees the swept fills and not the single hits at our price (paper_vs_live.txt),")
print("so its fills are the adverse half of what live would have had; the rules' effects on fills are read with that in mind.")
run('RW-C paper (10-08 -> 10-12)', fl, mins, None)
# live-prep's paper layer
lmin = {(r[1], int(r[0])): r for r in lpp}
fl2 = []
for c, mi, ts, s, p, z, tside, tpx, co in P['lpprep_fills']:
    row = lmin.get((c, int(mi)))
    w = None if (row is None or row[3] is None or row[4] is None) else 100 * (float(row[4]) - float(row[3]))
    d = 1 if s == 'bid' else -1
    fl2.append({'cond': c, 't': float(ts), 'd': d, 'y': float(p), 'size': float(z), 'width': w, 'tick': 0.01, 'print_y': None})
mins2 = []
for r in lpp:
    if r[5] is None and r[6] is None: continue
    w = None if r[3] is None or r[4] is None else 100 * (float(r[4]) - float(r[3]))
    mins2.append((r[0], r[1], float(r[11] or 0), w, None, None, None, None, 0.0, 0.0, 20.0, 0.01))
run("live-prep's paper layer (10-04 -> 10-09)", fl2, mins2, None)
