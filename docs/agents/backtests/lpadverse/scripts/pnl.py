# LP-ADVERSE: live-prep's fills P&L rebuilt (the engine's tokenBooks + settlements, marked at the touch's midpoint), checked
# against the stop event's own figure, and the loss taken apart.
#   LPADV_WORK=<scratch> python3 -I docs/agents/backtests/lpadverse/scripts/pnl.py > docs/agents/backtests/lpadverse/results/pnl.txt
import sys, os, pickle, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

F = pickle.load(open(os.path.join(WORK, 'fills.pkl'), 'rb'))
rows, settle = F['rows'], F['settle']
lm = []
for d in ('1009', '1010', '1011', '1012'): lm.extend(jload(f'lm_{d}.json.gz')['rows'])
tg = jload('targets.json')['ids']
rb = pickle.load(open(os.path.join(WORK, 'books.pkl'), 'rb'))
cond_of_id = {r[0]: r[1] for r in tg}
rec = {}
for i, rs in rb['books'].items():
    c = cond_of_id.get(i)
    if c: rec[c] = {int(x[0]): x for x in rs}
lmi = {(r[1], int(r[0])): r for r in lm}

STOP = ep('2026-10-12T07:30:00+00:00')
NOW = max(r['t'] for r in rows) + 60

def venue_mid(c, T):
    """The venue's touch midpoint at minute T (pm-rec's book, ours in it), else live-prep's own minute (without ours)."""
    m = int(T // 60 * 60)
    x = rec.get(c, {}).get(m)
    if x and x[2] and x[3]: return (x[2][0][0] + x[3][0][0]) / 2, 'rec'
    r = lmi.get((c, m))
    if r and r[2] is not None and r[3] is not None: return (float(r[2]) + float(r[3])) / 2, 'lp'
    return None, None

def last_mid(c, T):
    for back in range(0, 7 * 86400, 60):
        v, s = venue_mid(c, T - back)
        if v is not None: return v, s, back
    return None, None, None

def value(c, T):
    s = settle.get(c)
    if s and s[1] <= T: return s[0], 'settled', 0
    return last_mid(c, T)

def book(T):
    """tokenBooks-equivalent per market in YES terms: realised + held marked, every fill to T."""
    by = {}
    for r in rows:
        if r['t'] > T: continue
        by.setdefault(r['cond'], []).append(r)
    total, per = 0.0, {}
    for c, fs in by.items():
        v, src, age = value(c, T)
        # cash + held x value, exactly the realised + unrealised of tokenBooks (average cost or not, the sum is the same)
        cash = sum(-r['d'] * r['y'] * r['size'] for r in fs)
        held = sum(r['d'] * r['size'] for r in fs)
        pnl = cash + held * (v if v is not None else 0)
        per[c] = (pnl, held, v, src, age, fs[0]['q'])
        total += pnl
    return total, per

print('== Reproduce the stop (2026-10-12 07:30 UTC): the event said fills P&L -129.35468923, paid 38.09591564, rebates 10.021761, basis -81.23701259')
for T, lab in ((STOP, 'stop 07:30'), (NOW, 'now ' + iso(NOW))):
    tot, per = book(T)
    print(f'{lab}: fills marked {tot:.2f}')
tot, per = book(STOP)
print('\nper market at the stop (fills cash + held at the venue mid), worst first:')
for c, (p, h, v, src, age, q) in sorted(per.items(), key=lambda kv: kv[1][0])[:15]:
    print(f'  {c[:10]} {p:>8.2f}  net YES {h:>8.1f} at {v if v is None else round(v,4)} ({src}, {age}s old)  {q[:70]}')
tot2, per2 = book(NOW)
print('\nper market now, worst first:')
for c, (p, h, v, src, age, q) in sorted(per2.items(), key=lambda kv: kv[1][0])[:15]:
    print(f'  {c[:10]} {p:>8.2f}  net YES {h:>8.1f} at {v if v is None else round(v,4)} ({src})  {q[:70]}')
pickle.dump({'stop': STOP, 'now': NOW, 'per_stop': per, 'per_now': per2}, open(os.path.join(WORK, 'pnl.pkl'), 'wb'))
