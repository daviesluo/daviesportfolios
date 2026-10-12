# LP-ADVERSE: where the paper's rewards went. A day's formula at selection (pm_lp_markets.formula_day, RW's first round
# at the selection's programme), what the minutes then scored (live: the programme as read each minute and our quotes as
# they rested; paper: the layer's own formula), and what Polymarket paid; and why a live quoted minute scored nothing.
#   LPADV_WORK=<scratch> python3 -I docs/agents/backtests/lpadverse/scripts/rewards.py > docs/agents/backtests/lpadverse/results/rewards.txt
import sys, os, pickle
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

aux = jload('live_aux.json')
lm = []
for d in ('1009', '1010', '1011', '1012'): lm.extend(jload(f'lm_{d}.json.gz')['rows'])
lpp = []
for d in ('a', 'b', 'c'): lpp.extend(jload(f'lpp_{d}.json.gz')['rows'])
rwc = []
for d in ('1008', '1009', '1010', '1011', '1012'): rwc.extend(jload(f'rwc_{d}.json.gz')['rows'])
P = jload('paper.json')
LP_R_DAY_CORRECTIONS_1009 = 8.081876  # Addendum 10 / 18: 10-09's live formula like for like

sel = {}
for m in aux['markets']:
    sel.setdefault(m['day'], []).append(m)
rd = {}
for r in aux['reward_days']:
    g = rd.setdefault(r['day'], [0.0, 0.0, 0.0, 0.0])
    g[0] += float(r['formula'] or 0); g[1] += float(r['formula_scored'] or 0)
    g[2] += float(r['paid'] or 0) + float(r['sponsored'] or 0); g[3] += float(r['rebate'] or 0)
lmd, lppd, rwcd = {}, {}, {}
for r in lm:
    d = day_of(r[0]); g = lmd.setdefault(d, [0.0, 0, 0, 0])
    g[0] += float(r[12] or 0); g[1] += 1
    if r[6] is not None and r[7] is not None: g[2] += 1
    if float(r[12] or 0) > 0: g[3] += 1
for r in lpp:
    d = day_of(r[0]); g = lppd.setdefault(d, [0.0, 0, 0, 0])
    g[0] += float(r[11] or 0); g[1] += 1
    if r[5] is not None and r[6] is not None: g[2] += 1
    if float(r[11] or 0) > 0: g[3] += 1
for r in rwc:
    d = day_of(r[0]); g = rwcd.setdefault(d, [0.0, 0, 0, 0])
    g[0] += float(r[13] or 0); g[1] += 1 if r[2] else 0
    if float(r[13] or 0) > 0: g[3] += 1
print("LP-ADVERSE: the reward side, live against paper, by UTC day.")
print("sel$: the day's selection's formula a day (RW's first round at the 00:00 programme, every selected market incl. refills);")
print("min$: what the minutes scored (live: programme as read each minute, quotes as they rested; paper: its own formula);")
print("paid / rebates: Polymarket's payout as the readout booked it (live only). mins: market-minutes recorded / two-sided / scoring.")
print(f"{'day':<12}{'path':<10}{'sel$':>9}{'min$':>9}{'min/sel':>8}{'paid':>8}{'rebates':>8}{'paid/min':>9}{'mins':>8}{'2-sided':>8}{'scoring':>8}")
for d in sorted(set(sel) | set(lmd) | set(lppd)):
    s = sum(float(m['formula_day'] or 0) for m in sel.get(d, []))
    if d in lppd:
        g = lppd[d]; print(f"{d:<12}{'paper':<10}{s:>9.2f}{g[0]:>9.2f}{g[0] / s if s else 0:>8.3f}{'':>8}{'':>8}{'':>9}{g[1]:>8}{g[2]:>8}{g[3]:>8}")
    if d in lmd:
        g = lmd[d]; f = g[0]
        if d == '2026-10-09': f_ll = LP_R_DAY_CORRECTIONS_1009
        else: f_ll = f
        r = rd.get(d, [0, 0, None, None])
        paid = '' if r[2] is None else f"{r[2]:>8.2f}"; reb = '' if r[3] is None else f"{r[3]:>8.2f}"
        pm = '' if r[2] is None or not f_ll else f"{r[2] / f_ll:>9.3f}"
        note = ' (10-09: minutes $%.2f at the stale programme; $%.2f like for like)' % (f, f_ll) if d == '2026-10-09' else ''
        print(f"{d:<12}{'LIVE':<10}{s:>9.2f}{f_ll:>9.2f}{f_ll / s if s else 0:>8.3f}{paid:>8}{reb:>8}{pm:>9}{g[1]:>8}{g[2]:>8}{g[3]:>8}{note}")
    if d in rwcd:
        g = rwcd[d]; print(f"{d:<12}{'RW-C':<10}{'':>9}{g[0]:>9.2f}{'':>8}{'':>8}{'':>8}{'':>9}{g[1]:>8}{'':>8}{g[3]:>8}")

# Live quoted minutes of selected markets: why the minute scored nothing.
print("\n== Live minutes of a market selected that day, state 'quote': what rested and whether it scored")
why = {}
for r in lm:
    if r[23] != 'quote': continue
    b, a = r[6] is not None, r[7] is not None
    f = float(r[12] or 0) > 0
    k = ('both sides rest' if b and a else 'one side rests' if (b or a) else 'nothing rests') + (', scores' if f else ', scores 0')
    g = why.setdefault(k, [0, 0.0]); g[0] += 1; g[1] += float(r[12] or 0)
tot = sum(g[0] for g in why.values())
for k, g in sorted(why.items(), key=lambda kv: -kv[1][0]):
    print(f"  {k:<32}{g[0]:>7} ({100 * g[0] / tot:5.1f} %)  formula ${g[1]:.2f}")
st = {}
for r in lm:
    g = st.setdefault(r[23] or '(none)', [0, 0.0]); g[0] += 1; g[1] += float(r[12] or 0)
print("Every live minute by the market's state: " + ', '.join(f"{k} {g[0]} (${g[1]:.2f})" for k, g in sorted(st.items(), key=lambda kv: -kv[1][0])))

# The programme as read against the selection's: the minute's formula at the selection's rate instead.
print("\n== The programme as read each minute against the selection's (live, 10-10 ->; 10-09 predates the minute's read)")
selrate = {(m['day'], m['cond']): float(m['rate'] or 0) for m in aux['markets']}
asread = atsel = 0.0; cut = gone = 0
for r in lm:
    d = day_of(r[0])
    if d < '2026-10-10': continue
    f = float(r[12] or 0); rate = float(r[13] or 0); s = selrate.get((d, r[1]))
    if s is None: continue
    asread += f
    if rate > 0: atsel += f * s / rate
    if rate < s - 1e-9: cut += 1
print(f"formula as read ${asread:.2f}; the same minutes at the selection's rate ${atsel:.2f} ({atsel / asread if asread else 0:.2f}x); "
      f"minutes whose rate read under the selection's: {cut}")
