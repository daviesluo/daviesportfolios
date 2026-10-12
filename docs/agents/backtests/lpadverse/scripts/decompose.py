# LP-ADVERSE: the fills' loss taken apart, two ways.
#   LPADV_WORK=<scratch> python3 -I docs/agents/backtests/lpadverse/scripts/decompose.py > docs/agents/backtests/lpadverse/results/decompose.txt
# (1) By time after each fill, which sums exactly to the fills P&L: d x size x [(m_fill - y) + (m_5m - m_fill) +
#     (m_60m - m_5m) + (V_now - m_60m)]: the half-spread captured against the mid just before the fill, the adverse move
#     in the next 5 minutes and from 5 to 60 minutes, and the move of what was carried after that to now (payout or last
#     mid). A fill with no recorded mid at a horizon carries the next available value.
# (2) By lot (first in, first out per token): what the exits realised against cost (and how much of it was exits sold
#     under cost), what resolutions realised, and what is still held at the mark.
import sys, os, pickle
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

F = pickle.load(open(os.path.join(WORK, 'fills2.pkl'), 'rb'))
settle = pickle.load(open(os.path.join(WORK, 'fills.pkl'), 'rb'))['settle']
def parts(r):
    v = r['V_now']
    m60 = r['m_60m'] if r['m_60m'] is not None else (r['m_6h'] if r['m_6h'] is not None else v)
    m5 = r['m_5m'] if r['m_5m'] is not None else m60
    m0 = r['m_fill'] if r['m_fill'] is not None else m5
    d, s, y = r['d'], r['size'], r['y']
    return [d * s * (m0 - y), d * s * (m5 - m0), d * s * (m60 - m5), d * s * (v - m60)]
def show(lab, rs):
    P = [sum(x) for x in zip(*[parts(r) for r in rs])] if rs else [0, 0, 0, 0]
    sh = sum(r['size'] for r in rs)
    c = lambda x: f"{x:>9.2f} ({100 * x / sh if sh else 0:>5.2f})"
    print(f"{lab:<26}{len(rs):>5}{sh:>7.0f} {c(P[0])} {c(P[1])} {c(P[2])} {c(P[3])} {c(sum(P))}")
print("LP-ADVERSE: the fills P&L to now (-129.43, pnl.py) by time after each fill. $ (cents a share).")
print(f"{'':<26}{'fills':>5}{'shares':>7} {'half-spread':>17} {'adverse 0-5m':>17} {'adverse 5-60m':>17} {'carried 60m->now':>17} {'total':>17}")
show('all', F)
show('BUY (entries)', [r for r in F if r['side'] == 'BUY'])
show('SELL (exits)', [r for r in F if r['side'] == 'SELL'])
show('d = +1 (adds YES)', [r for r in F if r['d'] == 1])
show('d = -1 (adds NO/sells YES)', [r for r in F if r['d'] == -1])
print('by type:')
for T in sorted({r['type'] for r in F}):
    show('  ' + T, [r for r in F if r['type'] == T])
print('by UTC day of the fill:')
for d in sorted({r['day'] for r in F}):
    show('  ' + d, [r for r in F if r['day'] == d])
show('all but 0x3090f7aa (MrBeast wk1)', [r for r in F if not r['cond'].startswith('0x3090f7aa')])

# (2) lots
fills = sorted(F, key=lambda r: r['t'])
q, lots = {}, []
for r in fills:
    key = (r['cond'], r['outcome'])
    if r['side'] == 'BUY':
        L = {'f': r, 'qty': r['size'], 'px': r['price'], 'rem': r['size'], 'exits': []}
        q.setdefault(key, []).append(L); lots.append(L)
    else:
        left = r['size']
        for L in q.get(key, []):
            if left <= 1e-9: break
            if L['rem'] <= 1e-9: continue
            x = min(L['rem'], left); L['rem'] -= x; left -= x
            L['exits'].append((x, r['price'], r))
ex_gain = ex_loss = res = held = 0.0; nloss = nwin = 0; sh_loss = sh_win = 0.0
for L in lots:
    c = L['f']['cond']; out = L['f']['outcome']
    for x, p, r in L['exits']:
        g = x * (p - L['px'])
        if g < 0: ex_loss += g; nloss += 1; sh_loss += x
        else: ex_gain += g; nwin += 1; sh_win += x
    if L['rem'] > 1e-9:
        v = L['f']['V_now']; mk = v if out == 'yes' else 1 - v
        if c in settle: res += L['rem'] * (mk - L['px'])
        else: held += L['rem'] * (mk - L['px'])
print("\n(2) By lot, first in first out per token:")
print(f"  exits sold at or over cost: {nwin} pieces, {sh_win:.0f} shares, {ex_gain:+.2f}")
print(f"  exits sold under cost:      {nloss} pieces, {sh_loss:.0f} shares, {ex_loss:+.2f}")
print(f"  lots closed by a resolution: {res:+.2f}")
print(f"  still held, at the mark:     {held:+.2f}  ({sum(L['rem'] for L in lots if L['f']['cond'] not in settle):.0f} shares)")
print(f"  total {ex_gain + ex_loss + res + held:+.2f}")
hold = {}
for L in lots:
    for x, p, r in L['exits']:
        hold.setdefault('exit', []).append((r['t'] - L['f']['t']) / 60)
hs = sorted(hold.get('exit', []))
if hs: print(f"  minutes from buy to exit: median {hs[len(hs) // 2]:.0f}, 25 % {hs[len(hs) // 4]:.0f}, 75 % {hs[3 * len(hs) // 4]:.0f}")
by = {}
for L in lots:
    k = 'MrBeast wk1 (0x3090f7aa)' if L['f']['cond'].startswith('0x3090f7aa') else L['f']['type']
    v = sum(x * (p - L['px']) for x, p, r in L['exits'])
    if L['rem'] > 1e-9:
        vv = L['f']['V_now']; mk = vv if L['f']['outcome'] == 'yes' else 1 - vv
        v += L['rem'] * (mk - L['px'])
    by[k] = by.get(k, 0.0) + v
print("  lots' P&L by type: " + ', '.join(f"{k} {v:+.2f}" for k, v in sorted(by.items(), key=lambda kv: kv[1])))
