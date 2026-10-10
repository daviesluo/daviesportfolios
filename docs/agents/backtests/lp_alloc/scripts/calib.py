# LP-ALLOC: live-prep's live day 2026-10-09 against the formula under the programme in force, to fix what R means for the
# simulator's rewards (which, with `liveProg`, are the formula under the minute's programme).
# python3 -I scripts/calib.py data/lp_minutes_live_1009.json.gz data/live_1009_progs.json [paid per market JSON] > results/calib.txt
# For each live minute: F_sel = the formula the path computed (the 00:00 programme); F_cur = the same re-priced at the rate in
# force (the last pm-rec reading at or before the minute), 0 where the programme had ended, its rate was under $10 or its N
# over 20 (the reward check would have taken no entry); F_both = F_sel where Polymarket's order-scoring said both our sides
# scored; F_cur_both = F_cur on those minutes. The formula is linear in the rate; a change of maximum spread (one market, from
# 10:11) keeps the recorded score and is counted apart.
import json, sys, gzip, bisect
from collections import defaultdict
op = gzip.open if sys.argv[1].endswith('.gz') else open
rows = json.load(op(sys.argv[1], 'rt'))['minutes'].split(';')
tl = json.load(open(sys.argv[2]))['markets']
paid = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else None
keys = {c[:10]: c for c in tl}
def prog(c, iso):
    xs = tl[keys[c[:10]]]; i = bisect.bisect_right([x[0] for x in xs], iso) - 1
    return xs[i] if i >= 0 else None
import datetime
agg = defaultdict(lambda: defaultdict(float))
for r in rows:
    f = r.split(',')
    c, t, rate, v, mn, F = f[0], int(f[1]), float(f[2]), float(f[3]), float(f[4]), float(f[5])
    bs, as_, pct = int(f[6]), int(f[7]), float(f[8])
    iso = datetime.datetime.utcfromtimestamp(t).strftime('%Y-%m-%dT%H:%M')
    p = prog(c, iso)
    ok = p is not None and p[1] is not None and p[1] >= 10 and p[2] and max(p[3], 5) <= 20
    Fc = F * p[1] / rate if ok else 0.0
    both = bs == 1 and as_ == 1
    a = agg[c[:10]]
    a['min'] += 1; a['F_sel'] += F; a['F_cur'] += Fc
    if F > 0: a['min_F'] += 1
    if Fc > 0: a['min_Fcur'] += 1
    if both: a['min_both'] += 1; a['F_both'] += F; a['F_cur_both'] += Fc
    if ok and p[2] != v: a['v_changed_min'] += 1
    if Fc > 0 and both: a['agree_both'] += 1
    if Fc > 0 and not both and bs >= 0 and as_ >= 0: a['cur_not_scoring'] += 1
    if Fc == 0 and both: a['scoring_not_cur'] += 1
cols = ['min', 'min_F', 'min_Fcur', 'min_both', 'agree_both', 'cur_not_scoring', 'scoring_not_cur', 'F_sel', 'F_cur', 'F_both', 'F_cur_both', 'v_changed_min']
print('per market, live 2026-10-09 (01:33 -> 23:59 UTC)')
print(f"{'market':<11}" + ''.join(f"{k:>16}" for k in cols) + (f"{'paid':>8}" if paid else ''))
T = defaultdict(float)
for c in sorted(agg):
    a = agg[c]
    for k in cols: T[k] += a[k]
    print(f"{c:<11}" + ''.join(f"{a[k]:>16.2f}" if k.startswith('F') else f"{a[k]:>16.0f}" for k in cols) + (f"{paid.get(c, 0):>8.2f}" if paid else ''))
print(f"{'total':<11}" + ''.join(f"{T[k]:>16.2f}" if k.startswith('F') else f"{T[k]:>16.0f}" for k in cols) + (f"{sum(paid.values()):>8.2f}" if paid else ''))
P = sum(paid.values()) if paid else None
print()
print(f"F_sel {T['F_sel']:.2f}, F_cur {T['F_cur']:.2f}, F_both {T['F_both']:.2f}, F_cur_both {T['F_cur_both']:.2f}")
print(f"of the minutes the current-programme formula scores ({T['min_Fcur']:.0f}), Polymarket said both sides scored in {T['agree_both']:.0f} ({100*T['agree_both']/max(1,T['min_Fcur']):.0f} %)")
if P is not None:
    for k in ['F_sel', 'F_cur', 'F_both', 'F_cur_both']: print(f"paid {P:.2f} / {k} = R {P / T[k]:.3f}")
