# LP-ALLOC: the simulator against live-prep's live day 2026-10-09 (alloc_run.ts `live`: the day's own selection imposed,
# from 01:33 UTC, the minute it first quoted live), per market: the simulator's formula against the live path's (as it ran,
# at the 00:00 programme, and under the programme in force), its fills against the live fills, and R in the simulator's
# units (what the readout paid on the same markets over the simulator's formula). python3 -I scripts/calib_sim.py > results/calib_sim.txt
import json, gzip
from collections import defaultdict
paid = json.load(open('data/readout_1009.json'))
live = json.load(open('data/lp_live_1009.json'))
lf = defaultdict(lambda: [0, 0.0])
for f in live['fills']: lf[f['cond'][:10]][0] += 1; lf[f['cond'][:10]][1] += float(f['size'])
fsel = defaultdict(float)
for r in json.load(gzip.open('data/lp_minutes_live_1009.json.gz', 'rt'))['minutes'].split(';'):
    q = r.split(','); fsel[q[0][:10]] += float(q[5])
# the like-for-like scored formula of the live path (lpcfg/results/rtrue.txt, on main): each minute at the listing's rate then
rtrue = {'0x045fdf4b': 0.879838, '0x5b3350e2': 0.314623, '0x5fec6675': 1.884818, '0x9235351e': 1.973267, '0xa326c49f': 0.968556,
         '0xecc209a6': 0.346739, '0xeee73848': 0.897922, '0xf0503539': 0.0, '0xf6f3f159': 0.65654, '0xfbd3437c': 0.159572}
for model, f in [('strict', 'results/raw/lb0/live.json.gz'), ('at-price', 'results/raw/lb0/live_atprice.json.gz')]:
    o = json.load(gzip.open(f, 'rt'))
    for arm, v in o.items():
        pm = {c[:10]: x for c, x in v['perMarket'].items()}
        print(f"== {model}: {arm}")
        print(f"   {'market':<11}{'sim formula':>12}{'live 00:00':>11}{'live true':>10}{'paid':>7}{'sim fills':>10}{'sim sh':>8}{'live fills':>11}{'live sh':>8}")
        T = defaultdict(float)
        for c in sorted(pm):
            x = pm[c]
            print(f"   {c:<11}{x['reward']:>12.2f}{fsel[c]:>11.2f}{rtrue[c]:>10.3f}{paid[c]:>7.3f}{x['fills']:>10}{x['fillShares']:>8.0f}{lf[c][0]:>11}{lf[c][1]:>8.0f}")
            for k, val in [('sim', x['reward']), ('sel', fsel[c]), ('true', rtrue[c]), ('paid', paid[c]), ('sf', x['fills']), ('ss', x['fillShares']), ('lf', lf[c][0]), ('ls', lf[c][1])]: T[k] += val
        print(f"   {'nine':<11}{T['sim']:>12.2f}{T['sel']:>11.2f}{T['true']:>10.3f}{T['paid']:>7.3f}{int(T['sf']):>10}{T['ss']:>8.0f}{int(T['lf']):>11}{T['ls']:>8.0f}")
        print(f"   R in the simulator's units = paid / sim formula = {T['paid']/T['sim']:.3f}; against the live path's like-for-like formula {T['paid']/T['true']:.3f}; ratio sim / live-true {T['sim']/T['true']:.2f}")
        print(f"   fills' P&L of the day in the simulator (at the record's marks): {v['daily'][0]['tot'] - v['daily'][0]['rew']:.2f}")
print("\nlive-prep's own fills of 10-09 on the eight markets the record marks, at 23:59's mid: -1.15 (scripts/live_fills.py); 0x9235351e (7 fills, 126 shares) is not in the record")
