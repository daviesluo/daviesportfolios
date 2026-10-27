# PR5-OPT: what a 28-day forward twin of each recommended change can show. For each, the daily difference against LIVE's rules
# at £600 on FWD ('at' fills) is resampled in 3-day circular blocks into 28-day windows (2,000 windows, seed 20261027); each window
# is scored by the bar the review proposes (its mean > 0 AND its own 3-day block bootstrap, 1,000 resamples, puts at most 10 % at
# or below 0; 20 % reported beside it). Reported: the pass rate at the replay's effect, at half of it, and at none (the difference shifted to mean 0:
# the false-pass rate). Writes results/power.json.   python3 -I scripts/power.py   (about a minute)
import os, sys, json, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sim, experiments as E

N, W, BL = 2000, 28, 3


def blocks(xs, n, rng):
    out = []
    while len(out) < n:
        i = rng.randrange(len(xs)); out.extend(xs[(i + j) % len(xs)] for j in range(BL))
    return out[:n]


def share_le0(win, rng):
    if sum(win) <= 0: return 1.0
    return sum(1 for _ in range(1000) if sum(blocks(win, len(win), rng)) <= 0) / 1000


if __name__ == '__main__':
    fm, fp = sim.load_fwd()
    V = {'book_usdt_2to1': {'size': E.sizes(lambda b, s, k: 2 if b == 'USDT-GBP' else 1)},
         'size_75_75_0': {'size': E.sizes(lambda b, s, k: {0.001: 1, 0.002: 1, 0.003: 0}[k])},
         'hold_min_1gbp': {'hold_min_gbp': 1.0}}
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
    json.dump(out, open(os.path.join(sim.HERE, 'results', 'power.json'), 'w'), indent=1)
