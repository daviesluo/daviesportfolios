# LP-REFILL's tables (results/analysis.txt) from scripts/refill_run.ts's raw results. python3 -I scripts/refill_analyse.py > results/analysis.txt
# Net $ a day = fills' P&L + R x formula reward (the simulator's units: R 0.47 is live-prep's 0.81 on its own formula,
# LP-ALLOC's calibration; 0.38-0.58 its band; 0.23 the stress). At-price fills (they reproduced live's), strict beside.
# Means are over the five full days 10-05 -> 10-09; 10-10 (00:00 -> 12:59 UTC, live-prep's second live day, a partial day)
# is shown apart. In sample: 10-05 -> 10-07; out of sample: 10-08, 10-09 and the partial 10-10.
import json, os, random
RS = [0.23, 0.38, 0.47, 0.58]; RP = 0.47
FULL = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']; IS = FULL[:3]; OOS = FULL[3:]
def load(st, at):
    p = f"results/raw/{st}{'_atprice' if at else ''}.json"
    return json.load(open(p)) if os.path.exists(p) else {}
def net(d, R): return d['tot'] - (1 - R) * d['rew']
def ser(a, R, days=FULL): return [net(d, R) for d in a['daily'] if d['day'] in days]
def mean(x): return sum(x) / len(x) if x else float('nan')
def dd(xs):
    c = p = l = 0
    for x in xs: c += x; p = max(p, c); l = min(l, c - p)
    return l
def boot(a, b, n=2000, seed=20261010):
    d = [x - y for x, y in zip(ser(a, RP), ser(b, RP))]
    rng = random.Random(seed); ms = sorted(mean([rng.choice(d) for _ in d]) for _ in range(n))
    return mean(d), ms[int(.05 * n)], ms[int(.95 * n)], sum(1 for x in d if x > 0)
def d10(a, R=RP):
    x = [net(d, R) for d in a['daily'] if d['day'] == '2026-10-10']; return x[0] if x else float('nan')
def info(a):
    ds = [d for d in a['daily'] if d['day'] in FULL]
    return {k: mean([d[k] for d in ds]) for k in ['comMean', 'heldClose', 'activeMean', 'zeroSlotMin', 'refills', 'guardBlocks', 'rew']} | {'comMax': max(d['comMax'] for d in ds), 'stop': any(d['stop'] for d in a['daily']), 'fills': mean([d['tot'] - d['rew'] for d in ds])}
HDR = f"{'arm':<52}{'R.23':>7}{'R.47':>7}{'R.58':>7}{'str.47':>8}{'IS':>7}{'OOS':>7}{'10-10':>7}  {'vs base [5-95%] up':<26}{'worst':>7}{'maxDD':>8}{'cap mean/peak':>14}{'held':>6}{'mkts':>6}{'0-slot min':>11}{'refills':>8}{'form$':>7}{'fills$':>8}{'stop':>5}"
def line(k, A, S, base):
    a = A[k]; i = info(a)
    b = boot(a, A[base]) if base and k != base else (0, 0, 0, 0)
    s = S.get(k)
    return (f"{k:<52}{mean(ser(a, .23)):>7.2f}{mean(ser(a, .47)):>7.2f}{mean(ser(a, .58)):>7.2f}{(mean(ser(s, .47)) if s else float('nan')):>8.2f}{mean(ser(a, .47, IS)):>7.2f}{mean(ser(a, .47, OOS)):>7.2f}{d10(a):>7.2f}  "
            f"{b[0]:>+6.2f} [{b[1]:+6.2f},{b[2]:+6.2f}] {b[3]}/5 {min(ser(a, .23)):>7.2f}{dd(ser(a, .23)):>8.2f}{i['comMean']:>8.0f}/{i['comMax']:<5.0f}{i['heldClose']:>6.0f}{i['activeMean']:>6.1f}{i['zeroSlotMin']:>11.0f}{i['refills']:>8.1f}{i['rew']:>7.1f}{i['fills']:>8.2f}{'yes' if i['stop'] else 'no':>5}")
print("LP-REFILL. at-price fills; net $ a day at R (simulator units) over 10-05..10-09; strict at 0.47 beside; IS 10-05..10-07, OOS 10-08..10-09, and 10-10 (partial, 13 h) apart.")
print("vs base: paired day bootstrap of the five days at R 0.47; worst / maxDD at R 0.23; cap: holdings at cost + resting buys; held: at the day's close; mkts: chosen markets quoting (not off) a minute, on average;")
print("0-slot min: minutes a day no chosen market's programme paid; refills a day; form$: formula a day; fills$: fills' P&L a day.")
for st, base in [('refill', 'none'), ('guards', 'none'), ('combo', 'none | guards none'), ('final', 'C300 | no refill | guards none'), ('final2', 'C300 | no refill | guards none'), ('deployed', 'no refill | guards none')]:
    A, S = load(st, True), load(st, False)
    if not A: continue
    print(f"\n== {st}"); print(HDR)
    keys = list(A)
    if st == 'guards':
        for pre in ['', 'live15 off15 allOut | ']:
            b = pre + 'none'
            for k in [x for x in keys if x.startswith(pre) and (pre or '|' not in x)]: print(line(k, A, S, b))
            print()
    else:
        for k in keys: print(line(k, A, S, base))
F = load('final', True)
if F:
    print("\n== final: the day-by-day net at R 0.47 (at-price) of today's rule and the candidates, $300")
    for k in [x for x in F if x.startswith('C300 ')]:
        print(f"{k:<70}" + ' '.join(f"{d['day'][5:]} {net(d, .47):>7.2f}" for d in F[k]['daily']))
E = load('episodes', True)
if E:
    print("\n== the live episodes: live-prep's own selections of 10-09 and 10-10 imposed from 10-09 01:33 to 10-10 12:59 UTC, quoted as it quoted then (00:00 programme, AI in), at-price.")
    print("   fills' P&L to the record's last mark, $ (shares bought) for the three markets, and the whole book's fills and rewards at R 0.47 over the two days")
    W = {'0x3090f7aa': 'MrBeast wk1 215-223M', '0xf6f3f159': 'MrBeast Gaming day1', '0x5b3350e2': 'Anthropic #1 AI'}
    print(f"{'guard':<36}" + ''.join(f"{v:>28}" for v in W.values()) + f"{'book fills':>12}{'book R.47':>11}{'formula':>9}")
    for k, a in E.items():
        pm = {x['c']: x for x in a['perMarket']}
        cells = ''.join(f"{(pm[c]['fills'] if c in pm else 0):>16.2f} ({(pm[c]['sh'] if c in pm else 0):>6.0f} sh) " for c in W)
        tot = sum(d['tot'] for d in a['daily']); rew = sum(d['rew'] for d in a['daily'])
        print(f"{k:<36}{cells}{tot - rew:>12.2f}{tot - .53 * rew:>11.2f}{rew:>9.2f}")
