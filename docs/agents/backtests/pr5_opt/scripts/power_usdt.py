# PR5-OPT, 2026-10-27 (for variant-7 and -8): power.py's reading for USDT-GBP 3:1 and USDT-GBP only, the same windows, seed
# and bar. Writes results/power_usdt.json.   python3 -I scripts/power_usdt.py   (about a minute)
import os, sys, json, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim, experiments as E
from power import N, W, blocks, share_le0

if __name__ == '__main__':
    fm, fp = sim.load_fwd()
    V = {'book_usdt_3to1': {'size': E.sizes(lambda b, s, k: 3 if b == 'USDT-GBP' else 1)},
         'book_usdt_only': {'size': E.sizes(lambda b, s, k: 1 if b == 'USDT-GBP' else 0)}}
    tr, cap = sim.run(fm, fp, E.FWD[0] - 2 * sim.DAY, E.FWD[1])
    _, base = E.summary(tr, cap, *E.FWD)
    out = {}
    for name, kw in V.items():
        tr, cap = sim.run(fm, fp, E.FWD[0] - 2 * sim.DAY, E.FWD[1], **kw)
        _, v = E.summary(tr, cap, *E.FWD)
        d = [a - b for a, b in zip(v, base)]
        mu = sum(d) / len(d)
        sd = (sum((x - mu) ** 2 for x in d) / len(d)) ** 0.5
        res = {'meanBpsDay': round(mu, 3), 'sdDailyDiffBps': round(sd, 3)}
        for tag, shift in (('atEffect', 0.0), ('atHalf', -0.5 * mu), ('atZero', -mu)):
            rng = random.Random(20261027)
            dd = [x + shift for x in d]
            shares = [share_le0(blocks(dd, W, rng), rng) for _ in range(N)]
            for cut in (0.20, 0.10):
                res[f'pass_{tag}_share<={cut:.2f}'] = round(sum(1 for x in shares if x <= cut) / N, 3)
        out[name] = res
        print(name, res)
    json.dump(out, open(os.path.join(sim.HERE, 'results', 'power_usdt.json'), 'w'), indent=1)
