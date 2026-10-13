# LP-BEST, step 1: the simulator against the live record (live-prep live, 2026-10-09 01:33 -> the stop 10-12 07:30, exits
# to 22:49). Three checks before the simulator prices anything:
#   A. mechanics: live's own orders (pm_lp_orders, each with its resting interval) through lib.py's fill rule on pm-rec's
#      tape and its reward formula on pm-rec's book (our orders taken out): fills, shares, P&L, markouts and formula
#      against the record;
#   B. the touch multiplier k: what live filled while it rested better than the touch, per side-minute, against what the
#      same rule fills on the same markets' minutes when we were not in the book (before each market's first live minute
#      and after the stop);
#   C. R: what Polymarket paid each live day over the simulator's formula of live's own resting quotes.
#   LPBEST_WORK=<scratch> LPADV_WORK=<LP-ADVERSE scratch> python3 -I docs/agents/backtests/lpbest/scripts/calib.py > results/calib.txt
# Also writes <work>/calib.json (k, R, the live days) for the scripts after it.
import sys, os, json, gzip, collections, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import lib
from lib import Market, fill_minute, day_of_min

LPADV = os.environ['LPADV_WORK']
def jl(p):
    op = gzip.open if p.endswith('.gz') else open
    with op(p, 'rt') as f: return json.load(f)

GO = 1791509580 // 60          # 2026-10-09 01:33 UTC, the go
STOP = 1791789000 // 60        # 2026-10-12 07:30 UTC, the stop (entries end)
END = 1791845340 // 60         # 2026-10-12 22:49 UTC, LP-ADVERSE's "now" (no live fill since: sql/live_reward_days.sql)
QUOTING_DAYS = (STOP - GO) / 1440
# the fill rule: 'price' (the default: price-time priority from the book we posted into, and the print's average price
# must reach ours), 'queue' (the priority alone), 'last' (always behind
# every order at our price)
QMODE = os.environ.get('CALIB_FILL', 'price')

lm = []
for d in ('1009', '1010', '1011', '1012'): lm.extend(jl(os.path.join(LPADV, f'lm_{d}.json.gz'))['rows'])
fills = jl(os.path.join(LPADV, 'live_fills.json'))['rows']
orders = jl(os.path.join(lib.WORK, 'live_orders.json.gz'))['rows']
rd = jl(os.path.join(lib.WORK, 'live_rd.json'))
settle = {s['cond']: s for s in (rd['settlements'] or [])}
cond2id = {v['cond']: k for k, v in lib.meta().items()}
ep = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()

by_cond = collections.defaultdict(list)
for r in lm: by_cond[r[1]].append(r)
live_f = collections.defaultdict(list)    # cond -> (ts, dYES, YES price, shares)
for f in fills:
    s = float(f['size']); p = float(f['price'])
    if f['o_outcome'] == 'yes': d, y = (1 if f['side'] == 'BUY' else -1), p
    else: d, y = (-1 if f['side'] == 'BUY' else 1), 1 - p
    live_f[f['cond']].append((ep(f['match_time']), d, y, s))
ords = collections.defaultdict(list)      # cond -> [start, end, side +1 bid / -1 ask, YES price, size]
for o in orders:
    cond, ts, outc, side, price, size, state, matched, filled_at, creq, canc, upd, expi, h = o
    if state == 'rejected' or ts is None: continue
    ts = float(ts); price = float(price); size = float(size)
    ends = [float(x) for x in ((filled_at if state == 'filled' else None), canc, (float(expi) - 60) if expi else None) if x is not None]
    if state == 'live': ends.append(END * 60.0)
    end = min(ends) if ends else ts + 60
    if outc == 'yes': sd, y = (1 if side == 'BUY' else -1), price
    else: sd, y = (-1 if side == 'BUY' else 1), 1 - price
    ords[cond].append([ts, max(end, ts), sd, y, size])

def resting_at(lst, x):
    return [o for o in lst if o[0] <= x < o[1]]

def mark_end(M, cond):
    s = settle.get(cond)
    if s and s.get('payout') is not None:
        pay = s['payout']
        if isinstance(pay, dict): pay = pay.get('yes', pay.get('YES'))
        try: return float(pay)
        except Exception: pass
    ok = np.where((M.t <= END) & ~np.isnan(M.mid))[0]
    return float(M.mid[ok[-1]]) if len(ok) else None

def mid_at(M, t):
    i = np.searchsorted(M.t, t)
    for j in range(i, min(i + 30, len(M.t))):
        if not np.isnan(M.mid[j]): return float(M.mid[j])
    return None

out = {'days': QUOTING_DAYS}
fday_true = collections.defaultdict(float); fday_code = collections.defaultdict(float); fday_live = collections.defaultdict(float)
fmd = collections.defaultdict(lambda: [0.0, 0.0])   # (day, cond) -> [two-sided formula (min), the one-sided third on top of it]
print("LP-BEST calibration: the simulator against live-prep's live record")
print(f"live window: go 2026-10-09 01:33 -> stop 2026-10-12 07:30 ({QUOTING_DAYS:.3f} quoting days), exits to 22:49 UTC")
print(f"live orders read: {len(orders)} ({sum(1 for o in orders if o[6] == 'rejected')} rejected, left out); live fills: {len(fills)}\n")

tot = collections.Counter(); per_day = collections.defaultdict(collections.Counter)
mk_rows = []
kdata = collections.defaultdict(lambda: [0.0, 0, 0.0, 0])   # cond -> [touch shares, live touch side-minutes, no-us shares, no-us side-minutes]
mo_live = []; mo_sim = []
for cond, rows in sorted(by_cond.items()):
    mid_ = cond2id.get(cond)
    if mid_ is None or not os.path.exists(os.path.join(lib.WORK, 'mk', f'{mid_}.npz')):
        tot['markets without a pm-rec book'] += 1; continue
    lst = ords.get(cond, [])
    mins = sorted(set(int(r[0]) // 60 for r in rows))
    # what rested at an instant: the best bid and ask of ours and their sizes. The live turn cancels at about :01 and
    # posts at about :07; pm-rec read its books at about :03.7 (its frames' `at`). So the recorded book is cleaned of
    # what rested at :03.5, and the formula scores what rested at :30 (Polymarket samples once a minute at random).
    def ours_at(x):
        rs = resting_at(lst, x)
        bids = [o for o in rs if o[2] == 1]; asks = [o for o in rs if o[2] == -1]
        b = max(bids, key=lambda o: o[3]) if bids else None; a = min(asks, key=lambda o: o[3]) if asks else None
        return (b[3] if b else None, sum(o[4] for o in bids if b and abs(o[3] - b[3]) < 1e-9), a[3] if a else None,
                sum(o[4] for o in asks if a and abs(o[3] - a[3]) < 1e-9))
    clean = {t: ours_at(t * 60 + 3.5) for t in mins}
    ours = {t: ours_at(t * 60 + 30) for t in mins}
    M = Market(mid_, our_orders=clean)
    cash_s = net_s = 0.0
    sim_fills = []
    left = {id(o): o[4] for o in lst}
    # queue position: the others' size already at our price in the book of the minute we posted (0 when our price was
    # better than the touch, or a level nobody held): price-time priority keeps us ahead of whoever joins later
    qpos = {}
    for o in lst:
        j = M.index.get(int(o[0] // 60))
        if j is None: qpos[id(o)] = 0.0; continue
        P, S = (M.bp[j], M.bs[j]) if o[2] == 1 else (M.ap[j], M.as_[j])
        qpos[id(o)] = float(np.nansum(np.where(np.abs(P - o[3]) < 1e-9, S, 0)))
    # A. fills: each print against the orders resting at its match time (the tape's second less 3 s, LP-SPEED)
    for (pts, d, y, s) in M.pr:
        x = pts - 3
        if x < GO * 60 - 120 or x > END * 60 + 60: continue
        i = M.index.get(int(x // 60))
        if i is None: continue
        side = -int(d)
        cands = sorted([o for o in resting_at(lst, x) if o[2] == side and left[id(o)] > 1e-9], key=lambda o: -o[3] * side)
        rem = s
        for o in cands:
            px = o[3]
            if side == 1:
                top = np.isnan(M.bb[i]) or px > M.bb[i] + 1e-9
                ahead = np.nansum(np.where(M.bp[i] > px + 1e-9, M.bs[i], 0)); same = np.nansum(np.where(np.abs(M.bp[i] - px) < 1e-9, M.bs[i], 0))
            else:
                top = np.isnan(M.ba[i]) or px < M.ba[i] - 1e-9
                ahead = np.nansum(np.where(M.ap[i] < px - 1e-9, M.as_[i], 0)); same = np.nansum(np.where(np.abs(M.ap[i] - px) < 1e-9, M.as_[i], 0))
            D = 0.0 if top else float(ahead + (same if QMODE == 'last' else min(same, qpos[id(o)])))
            if QMODE == 'price' and ((side == 1 and y > px + 1e-9) or (side == -1 and y < px - 1e-9)): continue
            f = min(left[id(o)], max(0.0, rem - D))
            if f <= 1e-9: continue
            left[id(o)] -= f; rem -= f
            cash_s -= side * f * px; net_s += side * f
            sim_fills.append((x / 60, side, px, f, top))
    # A/C. the formula of what rested at each live minute's read, on the cleaned book, at live's programme read
    f_code = f_true = f_live = 0.0
    for r in rows:
        t = int(r[0]) // 60
        f_live += float(r[12] or 0); fday_live[day_of_min(t)] += float(r[12] or 0)
        i = M.index.get(t)
        if i is None or r[13] is None: continue
        b, bq, a, aq = ours.get(t, (None, 0, None, 0))
        if b and not np.isnan(M.bb[i]) and b > M.bb[i] + 1e-9: kdata[cond][1] += 1
        if a and not np.isnan(M.ba[i]) and a < M.ba[i] - 1e-9: kdata[cond][1] += 1
        if not (b or a): continue
        v = float(r[14]); ms = float(r[15]); rate = float(r[13]); m = M.m[i]; oth = M.others[i]
        if np.isnan(m) or not v: continue
        s1 = ((v - (m - b) * 100) / v) ** 2 * bq if b and 0 <= (m - b) * 100 < v and bq >= ms - 1e-9 else 0.0
        s2 = ((v - (a - m) * 100) / v) ** 2 * aq if a and 0 <= (a - m) * 100 < v and aq >= ms - 1e-9 else 0.0
        oc = min(s1, s2); ot = max(oc, max(s1, s2) / 3) if 0.10 <= m <= 0.90 else oc
        fc = rate / 1440 * oc / (oc + oth) if oc > 0 else 0.0
        ft = rate / 1440 * ot / (ot + oth) if ot > 0 else 0.0
        f_code += fc; f_true += ft; fday_code[day_of_min(t)] += fc; fday_true[day_of_min(t)] += ft
        md = fmd[(day_of_min(t), cond)]; md[0] += fc; md[1] += ft - fc
    lf = live_f.get(cond, [])
    endm = mark_end(M, cond)
    if endm is None: tot['markets without an end mark'] += 1; continue
    cash_l = -sum(d * s * y for (ts, d, y, s) in lf); net_l = sum(d * s for (ts, d, y, s) in lf)
    pnl_l = cash_l + net_l * endm; pnl_s = cash_s + net_s * endm
    for (ts, d, y, s) in lf:
        mo = mid_at(M, ts / 60 + 60)
        if mo is not None: mo_live.append(d * (mo - y) * s)
        dd = day_of_min(int(ts // 60)); per_day[dd]['live shares'] += s; per_day[dd]['live fills'] += 1
    # fill by fill: a simulator fill is live's when the market, side and price agree within 15 s of the match time
    used = set()
    for (t, side, px, sh, top) in sim_fills:
        hit = None
        for j, (ts, d, y, s) in enumerate(lf):
            if j in used or d != side or abs(y - px) > 1e-6 or abs(ts - t * 60) > 15: continue
            hit = j; break
        mo = mid_at(M, t + 60)
        key = 'matched' if hit is not None else 'sim only'
        if hit is not None: used.add(hit)
        tot[f'{key} fills'] += 1; tot[f'{key} shares'] += sh
        if mo is not None: tot[f'{key} mo60'] += side * (mo - px) * sh
    for j, (ts, d, y, s) in enumerate(lf):
        if j in used: continue
        mo = mid_at(M, ts / 60 + 60)
        tot['live only fills'] += 1; tot['live only shares'] += s
        if mo is not None: tot['live only mo60'] += d * (mo - y) * s
    for (t, side, px, sh, top) in sim_fills:
        mo = mid_at(M, t + 60)
        if mo is not None: mo_sim.append(side * (mo - px) * sh)
        dd = day_of_min(int(t)); per_day[dd]['sim shares'] += sh; per_day[dd]['sim fills'] += 1
        if top: kdata[cond][0] += sh
    tot['live fills'] += len(lf); tot['live shares'] += sum(s for *_, s in lf); tot['sim fills'] += len(sim_fills)
    tot['sim shares'] += sum(f[3] for f in sim_fills); tot['sim touch shares'] += sum(f[3] for f in sim_fills if f[4])
    tot['live pnl'] += pnl_l; tot['sim pnl'] += pnl_s; tot['formula live'] += f_live; tot['formula code'] += f_code; tot['formula true'] += f_true
    mk_rows.append((cond[:10], M.type, len(lf), sum(s for *_, s in lf), len(sim_fills), sum(f[3] for f in sim_fills), pnl_l, pnl_s, f_live, f_code, f_true))

    # B. the no-us rate: RW's inside price, 20 shares, a touch >= 2 ticks, before the market's first live minute or after the stop
    bi, ai = M.rw_quote()
    wide = (M.ba - M.bb) > 1.5 * M.tick
    first = mins[0]
    G = M.print_groups()
    for i, t in enumerate(M.t):
        if t < 1791158400 // 60 or t > END: continue      # 10-05 00:00 onwards
        if first <= t <= STOP: continue
        if not wide[i] or np.isnan(bi[i]): continue
        o = ours.get(int(t))
        rec = G.get(int(t), [])
        for side, px in ((1, bi[i]), (-1, ai[i])):
            if o is not None and ((side == 1 and o[0]) or (side == -1 and o[2])): continue
            kd = kdata[cond]; kd[3] += 1
            sh, _ = fill_minute(rec, side, px, 20.0, 0.0, True)
            kd[2] += sh

print("A. Live's own orders through the simulator (pm-rec's book less our orders; pm-rec's tape)")
print(f"   markets {len(mk_rows)}; skipped: {dict((k, v) for k, v in tot.items() if k.startswith('markets'))}")
print(f"   fills: live {tot['live fills']} ({tot['live shares']:.0f} shares), simulator {tot['sim fills']} ({tot['sim shares']:.0f} shares, "
      f"{tot['sim touch shares']:.0f} of them better than the touch)")
print(f"   fills P&L to 22:49 (marked at the same end mids / payouts): live {tot['live pnl']:+.2f}, simulator {tot['sim pnl']:+.2f}")
ml, ms_ = np.array(mo_live), np.array(mo_sim)
print(f"   60-minute markout: live ${ml.sum():+.2f} on {len(ml)} fills ({100 * ml.sum() / max(1, tot['live shares']):+.2f} c a share); "
      f"simulator ${ms_.sum():+.2f} on {len(ms_)} fills ({100 * ms_.sum() / max(1, tot['sim shares']):+.2f} c a share)")
for key in ('matched', 'sim only', 'live only'):
    print(f"   {key:<10}: {tot[key + ' fills']:>4.0f} fills, {tot[key + ' shares']:>6.0f} shares, 60-minute markout ${tot[key + ' mo60']:+.2f} "
          f"({100 * tot[key + ' mo60'] / max(1, tot[key + ' shares']):+.2f} c a share)")
print(f"   formula over live's minutes: as live recorded ${tot['formula live']:.2f}; simulator at live's code (two-sided min) "
      f"${tot['formula code']:.2f}; at Polymarket's Q_min (one side scores a third) ${tot['formula true']:.2f}")
print("   by day:")
for d in sorted(per_day):
    c = per_day[d]
    print(f"     {d}  live {c['live fills']:>4.0f} fills {c['live shares']:>7.0f} sh   sim {c['sim fills']:>4.0f} fills {c['sim shares']:>7.0f} sh")
print("   by market (cond, type | live fills, shares | sim fills, shares | live P&L, sim P&L | formula live rec / sim code / sim Q_min):")
for r in sorted(mk_rows, key=lambda r: r[6]):
    if r[2] == 0 and r[4] == 0 and r[8] < 0.5: continue
    print(f"     {r[0]} {r[1]:<20} {r[2]:>4} {r[3]:>7.0f} | {r[4]:>4} {r[5]:>7.0f} | {r[6]:>+8.2f} {r[7]:>+8.2f} | {r[8]:>7.2f} {r[9]:>7.2f} {r[10]:>7.2f}")
out['A'] = {k: v for k, v in tot.items()}

print("\nB. The touch multiplier k")
rows_k = [(c, kd[0], kd[1], kd[2], kd[3], kd[2] / kd[3]) for c, kd in kdata.items() if kd[1] > 0 and kd[3] > 0]
lsh = sum(r[1] for r in rows_k); lmin = sum(r[2] for r in rows_k); exp = sum(r[5] * r[2] for r in rows_k)
k = lsh / exp if exp else float('nan')
print(f"   markets with both: {len(rows_k)}; live filled {lsh:.0f} shares better than the touch, in {lmin} side-minutes it rested there")
print(f"   the same rule on those markets' no-us side-minutes (RW's inside price, 20 shares, touch >= 2 ticks): "
      f"{sum(r[3] for r in rows_k):.0f} shares in {sum(r[4] for r in rows_k)} side-minutes")
print(f"   live's side-minutes at each market's no-us rate would have filled {exp:.0f} shares  ->  k = {k:.2f}")
rnd = np.random.default_rng(20261013); ks = []
arr = np.array([(r[1], r[5] * r[2]) for r in rows_k])
for _ in range(2000):
    s = arr[rnd.integers(0, len(arr), len(arr))]
    if s[:, 1].sum() > 0: ks.append(s[:, 0].sum() / s[:, 1].sum())
lo, mi_, hi = np.percentile(ks, [5, 50, 95])
print(f"   k over a market bootstrap: 5 % {lo:.2f}, median {mi_:.2f}, 95 % {hi:.2f}")
out['k'] = k; out['k_lo'] = lo; out['k_hi'] = hi

print("\nC. R: what Polymarket paid over the simulator's formula of live's own resting quotes, by day")
paid = collections.defaultdict(float); reb = collections.defaultdict(float)
for r in rd['reward_days']:
    paid[r['day']] += float(r['paid'] or 0) + float(r['sponsored'] or 0); reb[r['day']] += float(r['rebate'] or 0)
print(f"   {'day':<12}{'paid':>8}{'rebates':>9}{'formula live rec':>18}{'sim code':>10}{'sim Q_min':>10}{'R (Q_min)':>10}")
for d in sorted(paid):
    print(f"   {d:<12}{paid[d]:>8.2f}{reb[d]:>9.2f}{fday_live[d]:>18.2f}{fday_code[d]:>10.2f}{fday_true[d]:>10.2f}{paid[d] / fday_true[d] if fday_true[d] else 0:>10.3f}")
d3 = ['2026-10-10', '2026-10-11', '2026-10-12']
R = sum(paid[d] for d in d3) / sum(fday_true[d] for d in d3)
R4 = sum(paid.values()) / sum(fday_true[d] for d in paid)
print(f"   R on 10-10 -> 10-12 (programme read every minute): {R:.3f}; with 10-09 (its morning on the selection's programme): {R4:.3f}")
out['R'] = R; out['R4'] = R4
# what Polymarket paid each market-day against the two parts of the formula: paid = R2 x two-sided + R1 x one-sided third
X = []; Y = []; keys = []
for r in rd['reward_days']:
    if r['day'] not in d3: continue
    f2, f1 = fmd.get((r['day'], r['cond']), (0.0, 0.0))
    X.append((f2, f1)); Y.append(float(r['paid'] or 0) + float(r['sponsored'] or 0)); keys.append((r['day'], r['cond']))
X = np.array(X); Y = np.array(Y)
from itertools import product
best = None
for r2, r1 in product(np.arange(0, 1.501, 0.01), np.arange(0, 1.501, 0.01)):
    e = ((Y - X[:, 0] * r2 - X[:, 1] * r1) ** 2).sum()
    if best is None or e < best[0]: best = (e, r2, r1)
_, R2, R1 = best
print(f"   market-days 10-10 -> 10-12: {len(Y)}; paid ${Y.sum():.2f}; two-sided formula ${X[:, 0].sum():.2f}, one-sided third ${X[:, 1].sum():.2f}")
print(f"   least squares over market-days: paid = {R2:.2f} x two-sided + {R1:.2f} x one-sided (R on the two-sided part alone, "
      f"paid / two-sided: {Y.sum() / X[:, 0].sum():.3f})")
rnd = np.random.default_rng(20261013); bs2 = []
for _ in range(1000):
    s = rnd.integers(0, len(Y), len(Y))
    bs2.append(Y[s].sum() / max(1e-9, X[s, 0].sum()))
print(f"   paid / two-sided over a market-day bootstrap: 5 % {np.percentile(bs2, 5):.3f}, 95 % {np.percentile(bs2, 95):.3f}")
out['R2'] = float(R2); out['R1'] = float(R1); out['R_two'] = float(Y.sum() / X[:, 0].sum())
out['R_two_lo'] = float(np.percentile(bs2, 5)); out['R_two_hi'] = float(np.percentile(bs2, 95))
out['k_vol'] = float(tot['live shares'] / max(1, tot['sim shares']))
# rebates: Polymarket's published share of the taker fee feeRate x p(1 - p) on each live fill, scaled to what was paid
fee_base = 0.0
for c, lf in live_f.items():
    fr, sh = lib.fee_and_share(lib.meta().get(cond2id.get(c), {}).get('fee'))
    fee_base += sum(sh * fr * y * (1 - y) * s for (ts, d, y, s) in lf)
out['rebate_scale'] = float(sum(reb.values()) / fee_base) if fee_base else 1.0
print(f"   rebates: paid ${sum(reb.values()):.2f} on the published schedule's ${fee_base:.2f} -> scale {out['rebate_scale']:.2f}")
print(f"\nD. The simulator's fill volume against live's: live {tot['live shares']:.0f} shares / simulator {tot['sim shares']:.0f} = k_vol {out['k_vol']:.3f} (fill rule '{QMODE}')")
out['paid'] = dict(paid); out['rebates'] = dict(reb)
json.dump(out, open(os.path.join(lib.WORK, 'calib.json'), 'w'), indent=1, default=float)
