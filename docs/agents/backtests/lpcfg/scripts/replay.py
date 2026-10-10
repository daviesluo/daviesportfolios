# LPCFG: live-prep's 2026-10-09 live minutes replayed under the reward check and its backstop (Addendum 9).
# python3 -I scripts/replay.py data/minutes_2026-10-09.json data/fills_2026-10-09.json data/config_timeline.json [data/readout_2026-10-09.json] > results/replay.txt
#
# What it reads. Every live minute the path recorded on 10-09 (pm_lp_minutes, mode live: the selection's programme, our
# quotes, the formula, Polymarket's order-scoring verdict per side), every fill of the day (pm_lp_fills), each market's
# programme through the day as pm-rec's universe frames read the CLOB's listing every 15 minutes (scripts/timeline.py),
# and, once written, the readout of 10-09 (pm_lp_reward_days, mode live: what Polymarket paid per market).
#
# The fixed rules, minute by minute, on the programme in force (the last pm-rec read at or before the minute):
#   check     the market may enter while the listing shows it at $10 a day or more, with a maximum spread, and N =
#             max(minimum, 5) <= 20; a market the listing no longer shows has no programme.
#   backstop  a minute in which both sides read not scoring while the formula scored both (qBid, qAsk > 0) adds one,
#             either side scoring starts again, anything else leaves the count; at M the market is out for the day.
#   formula   a minute it may enter: the recorded formula times rate now / rate selected (the formula is linear in the
#             rate; the minimum never fell under our 20 where the check passes, so our score and the others' are the
#             recorded ones; where the spread changed, 0x9235351e from 10:11, the recorded score is kept and the minute
#             is counted apart as approximate). A minute it is out: 0 (it rests only the sells of what it holds, one
#             side: our score is the smaller side's).
# Limits, said in the output: the live path reads the CLOB every minute, the replay knows the programme only at
# pm-rec's 15-minute reads, so a change takes up to 15 minutes longer to stop entries here than it would live; and a
# fill in a minute the fixed rule has the market out is counted as one that rule would not have taken, which holds for
# buys (no buy rests there) and not for every sell.
import json, sys, bisect
from collections import defaultdict

mins = json.load(open(sys.argv[1])); F = {k: i for i, k in enumerate(mins['fields'])}
fills = json.load(open(sys.argv[2]))
tl = json.load(open(sys.argv[3]))['markets']
readout = json.load(open(sys.argv[4])) if len(sys.argv) > 4 else None
DAY = '2026-10-09'
KEPT = ['0x9235351e', '0x5b3350e2', '0x5fec6675', '0xeee73848', '0xf6f3f159']   # the markets the brief names as keeping their programme
sizeN = lambda m: max(m, 5)

def prog(c, hhmm):
    xs = tl[c]; i = bisect.bisect_right([x[0] for x in xs], f'{DAY}T{hhmm}') - 1
    return xs[i] if i >= 0 else None

def ok(p):
    return p is not None and p[1] is not None and p[1] >= 10 and p[2] and p[2] > 0 and sizeN(p[3]) <= 20

def why(p):
    if p is None or p[1] is None: return 'programme ended'
    if p[1] < 10: return 'rate under $10'
    if sizeN(p[3]) > 20: return 'minimum over 20'
    return 'other'

by = defaultdict(list)
for r in mins['rows']: by[r[F['cond10']]].append(r)
num = lambda x: float(x or 0)

def run(M, quiet=False):
    out = {}
    for c, rs in sorted(by.items()):
        n, dropped_at = 0, None
        a = dict(rec=0.0, rec_sc=0.0, fix=0.0, fix_sc=0.0, approx=0.0, mm=0, mm_out=0, mm_out_cfg=0, mm_out_bs=0, two=0, two_out=0, fires=0, why=defaultdict(int))
        for r in rs:
            hm = r[F['minute']]; p = prog(c, hm); f = num(r[F['formula_usd']])
            bs, as_ = r[F['bid_scoring']], r[F['ask_scoring']]; scored = bs is True and as_ is True
            a['mm'] += 1; a['rec'] += f; a['rec_sc'] += f if scored else 0
            two = num(r[F['ours']]) > 0; a['two'] += two
            cfg_ok = ok(p)
            if cfg_ok and dropped_at is None:
                if bs is True or as_ is True: n = 0
                elif bs is False and as_ is False and num(r[F['qBid']]) > 0 and num(r[F['qAsk']]) > 0: n += 1
                if n >= M: dropped_at = hm; a['fires'] += 1
            out_now = (not cfg_ok) or (dropped_at is not None)
            if out_now:
                a['mm_out'] += 1; a['two_out'] += two
                if not cfg_ok: a['mm_out_cfg'] += 1; a['why'][why(p)] += 1
                else: a['mm_out_bs'] += 1
                continue
            g = f * p[1] / num(r[F['rate']])
            a['fix'] += g; a['fix_sc'] += g if scored else 0
            if p[2] != num(r[F['max_spread']]): a['approx'] += g
        a['dropped_at'] = dropped_at
        out[c] = a
    return out

def fills_out(res):
    """The day's fills in minutes the fixed rule had the market out, by side."""
    o = defaultdict(lambda: [0, 0.0, 0.0])
    out_minutes = defaultdict(set)
    for c, rs in by.items():
        drop = res[c]['dropped_at']
        for r in rs:
            hm = r[F['minute']]
            if not ok(prog(c, hm)) or (drop is not None and hm >= drop): out_minutes[c].add(hm)
    tot = defaultdict(lambda: [0, 0.0, 0.0])
    for t, c, is_yes, side, price, size, status in fills['rows']:
        hm = t[11:16]
        k = (side, 'out' if hm in out_minutes[c] else 'in')
        for d in (o[(c,) + k], tot[k]):
            d[0] += 1; d[1] += float(size); d[2] += float(size) * float(price)
    return o, tot

P = lambda *x: print(*x)
P('LPCFG replay of live-prep, 2026-10-09 (UTC), live minutes 01:33-23:59')
P(f'inputs: {len(mins["rows"])} market-minutes, {len(fills["rows"])} fills, programme timeline of {len(tl)} markets at 15-minute reads')
P()
P('== M, the backstop: runs on the five markets that kept a paying programme (the brief), and when it fires elsewhere')
for M in range(1, 7):
    res = run(M)
    fp = sum(res[c]['fires'] for c in KEPT)
    P(f'  M={M}: fires on the kept five {fp} time(s); fires on ' + ', '.join(f'{c} at {res[c]["dropped_at"]}' for c in sorted(res) if res[c]['dropped_at'] and c not in KEPT) + ('; on kept: ' + ', '.join(f'{c} at {res[c]["dropped_at"]}' for c in KEPT if res[c]['dropped_at']) if fp else ''))
M = 3
res = run(M)
P()
P(f'== per market, M = {M} (formula in $; mm = market-minutes recorded; out = minutes the fixed rules take no entry)')
P(f'  {"market":10} {"recorded":>9} {"rec scored":>10} {"fixed":>8} {"fixed sc":>8} {"mm":>5} {"out":>5} {"cfg":>5} {"bstop":>5} {"2-sided out":>11}  backstop   why out (minutes)')
T = defaultdict(float)
for c in sorted(res):
    a = res[c]
    for k in ('rec', 'rec_sc', 'fix', 'fix_sc', 'approx', 'mm', 'mm_out', 'mm_out_cfg', 'mm_out_bs', 'two', 'two_out'): T[k] += a[k]
    P(f'  {c:10} {a["rec"]:9.2f} {a["rec_sc"]:10.2f} {a["fix"]:8.2f} {a["fix_sc"]:8.2f} {a["mm"]:5d} {a["mm_out"]:5d} {a["mm_out_cfg"]:5d} {a["mm_out_bs"]:5d} {a["two_out"]:11d}  {a["dropped_at"] or "-":9}  {dict(a["why"])}')
P(f'  {"all":10} {T["rec"]:9.2f} {T["rec_sc"]:10.2f} {T["fix"]:8.2f} {T["fix_sc"]:8.2f} {int(T["mm"]):5d} {int(T["mm_out"]):5d} {int(T["mm_out_cfg"]):5d} {int(T["mm_out_bs"]):5d} {int(T["two_out"]):11d}')
P(f'  of the fixed formula, {T["approx"]:.2f} is in minutes whose spread had changed (approximate: the recorded score kept)')
P()
o, tot = fills_out(res)
P('== fills in minutes the fixed rules have the market out (would not have rested: buys; sells are counted, not removed)')
for k in sorted(tot): P(f'  {k[0]:4} {k[1]:3}: {tot[k][0]:3d} fills, {tot[k][1]:7.1f} shares, ${tot[k][2]:7.2f}')
for k in sorted(o):
    if k[2] == 'out': P(f'    {k[0]:10} {k[1]:4}: {o[k][0]:3d} fills, {o[k][1]:6.1f} shares, ${o[k][2]:6.2f}')
P()
P('== R')
paid_pusd = 6.53
P(f'  the payout as the pUSD rise at 00:00 (no fill 23:57-00:05:01): ${paid_pusd:.2f}')
P(f'  R on the recorded formula {paid_pusd / T["rec"]:.4f}; on the recorded scored formula {paid_pusd / T["rec_sc"]:.4f}')
P(f'  R on the fixed formula {paid_pusd / T["fix"]:.4f}; on the fixed scored formula {paid_pusd / T["fix_sc"]:.4f}')
if readout:
    rows = {r['cond'][:10]: r for r in readout['rows']}
    act = sum(float(r['actual_usd'] or 0) + float(r['actual_sponsored_usd'] or 0) for r in rows.values())
    P(f'  the readout of 10-09 (pm_lp_reward_days, live, read {readout.get("read_at")}): paid ${act:.4f} over {len(rows)} markets')
    P(f'    R on: recorded {act / T["rec"]:.4f}, recorded scored {act / T["rec_sc"]:.4f}, fixed {act / T["fix"]:.4f}, fixed scored {act / T["fix_sc"]:.4f}')
    P(f'    {"market":10} {"paid":>8} {"recorded":>9} {"rec sc":>8} {"fixed":>8} {"fixed sc":>8}  R(fixed) R(fixed sc)')
    for c in sorted(res):
        r = rows.get(c); p = float(r['actual_usd'] or 0) + float(r['actual_sponsored_usd'] or 0) if r else 0.0
        a = res[c]
        rf = f'{p / a["fix"]:.3f}' if a['fix'] > 0 else '-'; rs = f'{p / a["fix_sc"]:.3f}' if a['fix_sc'] > 0 else '-'
        P(f'    {c:10} {p:8.4f} {a["rec"]:9.2f} {a["rec_sc"]:8.2f} {a["fix"]:8.2f} {a["fix_sc"]:8.2f}  {rf:>8} {rs:>8}')
else:
    P('  the readout of 10-09 was not yet written when this ran: R by market waits for it')
