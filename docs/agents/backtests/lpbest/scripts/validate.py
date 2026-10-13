# LP-BEST, step 2: the engine runs live-prep's own rule (as it stood, addendum by addendum) on live's own daily
# selections and refills, from the go (10-09 01:33) to 22:49 on 10-12 with the stop at 07:30, against the record:
# quoting minutes, formula, rewards, fills, the 60-minute markout, fills P&L and the total a day. Then the same split
# in time: the calibration (k_vol, R) from 10-09/10-10 alone, priced on 10-11/10-12.
#   LPBEST_WORK=<scratch> LPADV_WORK=<LP-ADVERSE scratch> python3 -I docs/agents/backtests/lpbest/scripts/validate.py > results/validate.txt
import sys, os, json, gzip, collections, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
os.environ['LPBEST_RAW_R'] = '1'   # the replay is priced at calib.py's R; it writes the engine's own R
import lib, engine
from engine import P, run

LPADV = os.environ['LPADV_WORK']
def jl(p):
    op = gzip.open if p.endswith('.gz') else open
    with op(p, 'rt') as f: return json.load(f)
ep = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
GO, STOP, END = 1791509580 // 60, 1791789000 // 60, 1791845340 // 60
ADD9 = 1791594840 // 60      # 2026-10-10 01:14 UTC: the reward check deployed (Addendum 9)
ADD14 = 1791644400 // 60     # 2026-10-10 15:00 UTC: the per-market loss guard (Addendum 14)
cal = engine.calib()
aux = jl(os.path.join(LPADV, 'live_aux.json'))
rd = jl(os.path.join(lib.WORK, 'live_rd.json'))
cond2id = {v['cond']: k for k, v in lib.meta().items()}

# live's schedule: each day's picks in rank order, a refill from the minute it was taken
sched = collections.defaultdict(list)
for m in sorted(aux['markets'], key=lambda m: (m['day'], m['rank'])):
    if m['day'] < '2026-10-09': continue
    mid = cond2id.get(m['cond'])
    if mid is None: continue
    st = int(ep(m['selected_at']) // 60) if m['refill'] else None
    sched[m['day']].append((mid, m['rank'], st))
settle = {cond2id.get(s['cond']): s for s in (rd['settlements'] or [])}
end_mark = {}
for mid, s in settle.items():
    pay = s.get('payout')
    if isinstance(pay, dict): pay = pay.get('yes', pay.get('YES'))
    try: end_mark[mid] = float(pay)
    except Exception: pass

ADD12 = 1791601200 // 60     # 2026-10-10 03:00 UTC: AI markets out (Addendum 12)
LIVE_POLICY = P(name='live-prep as run (replay)', cap_total=320.0, entries_until=STOP, prog_check_from=ADD9, guard_from=ADD14,
                exclude_lptypes=('AI',), exclude_from=ADD12)

# the record, by day
paid = collections.defaultdict(float); reb = collections.defaultdict(float); two = collections.defaultdict(int)
for r in rd['reward_days']:
    paid[r['day']] += float(r['paid'] or 0) + float(r['sponsored'] or 0); reb[r['day']] += float(r['rebate'] or 0); two[r['day']] += int(r['two'] or 0)
fills = jl(os.path.join(LPADV, 'live_fills.json'))['rows']
lfd = collections.Counter(); lsh = collections.Counter()
for f in fills:
    d = lib.day_of_min(int(ep(f['match_time']) // 60)); lfd[d] += 1; lsh[d] += float(f['size'])
LIVE_FILLS_PNL = -129.43          # LP-ADVERSE results/pnl.txt, fills and settlements marked at 22:49 (calib.txt reproduces it)
# live's own fills marked at each UTC day's end on the engine's mids, so a day's fills P&L compares like for like
lbook = collections.defaultdict(lambda: [0.0, 0.0])
lev = sorted(((ep(f['match_time']), f) for f in fills), key=lambda x: x[0])
live_mtm = {}
ix = 0
for d, tend in (('2026-10-09', 1791590399), ('2026-10-10', 1791676799), ('2026-10-11', 1791763199), ('2026-10-12', END * 60 + 59)):
    while ix < len(lev) and lev[ix][0] <= tend:
        f = lev[ix][1]; ix += 1
        s = float(f['size']); p = float(f['price'])
        dd, y = (((1 if f['side'] == 'BUY' else -1), p) if f['o_outcome'] == 'yes' else ((-1 if f['side'] == 'BUY' else 1), 1 - p))
        b = lbook[cond2id[f['cond']]]; b[0] -= dd * s * y; b[1] += dd * s
    tot = 0.0
    for mid, (cash, net) in lbook.items():
        M = engine.market(mid)
        mk = end_mark.get(mid) if d == '2026-10-12' and mid in end_mark else None
        if mk is None:
            j = np.searchsorted(M.t, tend // 60, side='right') - 1
            while j >= 0 and np.isnan(M.mid[j]): j -= 1
            mk = M.mid[j] if j >= 0 else 0.0
        tot += cash + net * mk
    live_mtm[d] = tot
live_day = {}; prev = 0.0
for d in sorted(live_mtm): live_day[d] = live_mtm[d] - prev; prev = live_mtm[d]
live_total = LIVE_FILLS_PNL + sum(paid.values()) + sum(reb.values())
days = (STOP - GO) / 1440

def show(res, label):
    print(f"== {label}")
    print(f"   {'day':<12}{'2-sided min':>12}{'formula2':>10}{'rewards':>9}{'rebates':>9}{'fills':>7}{'shares':>8}{'mo60':>9}{'fills P&L':>11}{'total':>9}")
    for d in sorted(res['daily']):
        x = res['daily'][d]
        print(f"   {d:<12}{x.get('minutes2', 0):>12.0f}{x.get('formula2', 0):>10.2f}{x.get('paid', 0):>9.2f}{x.get('rebate', 0):>9.2f}"
              f"{x.get('fills', 0):>7.0f}{x.get('shares', 0):>8.0f}{x.get('mo60', 0):>9.2f}{x.get('fills_day', 0):>11.2f}{x.get('total', 0):>9.2f}")
    print(f"   all: fills P&L {res['fills_pnl']:+.2f}, rewards {res['paid']:+.2f}, rebates {res['rebate']:+.2f}, total {res['total']:+.2f}; "
          f"{res['fills']} fills, {res['shares']:.0f} shares, 60-min markout {res['mo60']:+.2f}; "
          f"a quoting day ({days:.3f} days to the stop): {res['total'] / days:+.2f}")

print("LP-BEST validation: live-prep's own rule through the engine, on live's own selections")
print(f"calibration (calib.json): k_vol {cal['k_vol']:.3f}, R on the two-sided formula {cal['R_two']:.3f} [{cal['R_two_lo']:.3f}, {cal['R_two_hi']:.3f}], "
      f"one-sided third paid {cal['R1']:.2f} (least squares), rebate scale {cal['rebate_scale']:.2f}\n")
print("== The record (live)")
print(f"   {'day':<12}{'2-sided min':>12}{'paid':>9}{'rebates':>9}{'fills':>7}{'shares':>8}{'fills P&L':>11}{'total':>9}")
for d in sorted(paid):
    print(f"   {d:<12}{two[d]:>12}{paid[d]:>9.2f}{reb[d]:>9.2f}{lfd[d]:>7}{lsh[d]:>8.0f}{live_day.get(d, 0):>11.2f}{live_day.get(d, 0) + paid[d] + reb[d]:>9.2f}")
print(f"   (fills P&L by day: live's fills marked at each day's end on the engine's mids; they sum to {sum(live_day.values()):+.2f})")
print(f"   all: fills P&L {LIVE_FILLS_PNL:+.2f}, paid {sum(paid.values()):+.2f}, rebates {sum(reb.values()):+.2f}, total {live_total:+.2f}; "
      f"a quoting day: {live_total / days:+.2f}\n")

res = run(LIVE_POLICY, sched, GO, END, end_mark=end_mark)
show(res, 'the engine, live-prep as run, live calibration (k_vol, R from all four days)')
per_day = res['total'] / days
print(f"\n   VALIDATION: engine {per_day:+.2f} a day against live {live_total / days:+.2f} a day; difference {per_day - live_total / days:+.2f}")

# the record's own noise: a market bootstrap of live's total a day (fills P&L per market from LP-ADVERSE's split is not
# per market here, so the engine's own market bootstrap stands in for both)
books = list(res['books'].values())
x = np.array([b['pnl'] + b['paid'] + b['rebate'] for b in books])
lo, mi, hi = lib.boot(x)
print(f"   the engine's total over a market bootstrap: 5 % {lo / days:+.2f}, 50 % {mi / days:+.2f}, 95 % {hi / days:+.2f} a day")

# split in time: calibrate on 10-09/10-10, price 10-11/10-12
print("\n== Out of sample in time: R and k_vol from 10-09/10-10 only, the engine on 10-11 00:00 -> 10-12 22:49")
d2 = ['2026-10-10']
# R on 10-10 alone (10-09 predates the minute's programme check): the engine's own two-sided formula on 10-10
r_a = paid['2026-10-10'] / max(1e-9, res['daily']['2026-10-10'].get('formula2', 0))
r_b = (paid['2026-10-11'] + paid['2026-10-12']) / max(1e-9, res['daily']['2026-10-11'].get('formula2', 0) + res['daily']['2026-10-12'].get('formula2', 0))
print(f"   R from 10-10 alone: {r_a:.3f} (the engine's formula); what 10-11/10-12 then paid over the engine's formula: {r_b:.3f}")
pred = sum(res['daily'][d].get('fills_day', 0) for d in ('2026-10-11', '2026-10-12')) + r_a * sum(res['daily'][d].get('formula2', 0) for d in ('2026-10-11', '2026-10-12')) \
    + sum(res['daily'][d].get('rebate', 0) for d in ('2026-10-11', '2026-10-12'))
act = sum(live_day[d] + paid[d] + reb[d] for d in ('2026-10-11', '2026-10-12'))
print(f"   the engine's 10-11 + 10-12 at 10-10's R: {pred:+.2f}; live on those days (fills marked + paid + rebates): {act:+.2f}")
R_engine = sum(paid.values()) / res['formula2']
print(f"\n   R in the engine's units (what live was paid over the engine's two-sided formula of its own replay, every friction of the live path in it): {R_engine:.3f}")
print(f"   the replay again at that R: rewards {R_engine * res['formula2']:+.2f}, total {(res['fills_pnl'] + R_engine * res['formula2'] + res['rebate']) / days:+.2f} a day against live {live_total / days:+.2f}")
json.dump({'engine_per_day': per_day, 'live_per_day': live_total / days, 'R_1010': r_a, 'R_1011_12': r_b, 'R_engine': R_engine}, open(os.path.join(lib.WORK, 'validate.json'), 'w'))
