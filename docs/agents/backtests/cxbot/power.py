"""CXBOT audit (2026-10-29), §5: the power of design B (falsepass.py) for a forecaster WITH skill.

    python3 -I docs/agents/backtests/cxbot/power.py [windows] [seed] [alpha] [days]

The paths of falsepass.py plus a drift the forecaster knows: each coin's log price drifts by mu per day, held for 3-day
spells, mu = alpha x (one day's sd) x (0.8 F + 0.6 e) with F common to the three coins and e its own (so the forecaster's
views are as correlated across coins as a macro view is). The forecaster is calibrated: its p is the mean outcome of the
brackets of its own (direction x drift) bucket, learnt on separate paths. Reported: its mean |p - m|, mean D, and how
often design B passes (D > 0, the 3-day-block bootstrap's 5th percentile > 0, D_c > 0) in `days`-day windows.
"""
import sys
import numpy as np

W = int(sys.argv[1]) if len(sys.argv) > 1 else 100
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 20261029
ALPHA = float(sys.argv[3]) if len(sys.argv) > 3 else 0.3
DAYS = int(sys.argv[4]) if len(sys.argv) > 4 else 42
rng = np.random.default_rng(SEED)
HOLD_D, STEP_MIN, BLOCK_D, B, K_STOP, K_LIM = 3, 5, 3, 400, 1.0, 2.0
SPD = 24 * 60 // STEP_MIN
HOLD, EVERY = HOLD_D * SPD, 4 * 60 // STEP_MIN
SIG = np.array([0.40, 0.55, 0.70])
CH = np.linalg.cholesky(np.array([[1, .8, .75], [.8, 1, .8], [.75, .8, 1]]))
DT = 1 / 365 / SPD
S24 = SIG * np.sqrt(1 / 365)
NONE = 10 ** 9
EDGES = np.linspace(-2.5, 2.5, 11)


def paths(days):
    n = (days + HOLD_D + 1) * SPD
    spells = -(-n // (3 * SPD))
    f = rng.standard_normal((spells, 1))
    mu_spell = ALPHA * S24 * (0.8 * f + 0.6 * rng.standard_normal((spells, 3)))  # log drift per day
    mu = np.repeat(mu_spell, 3 * SPD, axis=0)[:n]
    z = rng.standard_normal((n, 3)) @ CH.T
    inc = (mu / SPD) - 0.5 * SIG ** 2 * DT + SIG * np.sqrt(DT) * z
    return np.vstack([np.zeros(3), np.cumsum(inc, axis=0)]), np.vstack([mu[:1], mu])


def first(mask):
    return int(np.argmax(mask)) if mask.any() else NONE


def brackets(x, mu, days):
    rows = []
    for c in range(3):
        for s in range(SPD, (days + 1) * SPD, EVERY):
            p = np.exp(x[s:s + HOLD + 1, c] - x[s, c])
            for d in (1, -1):
                stop, lim = np.exp(-d * K_STOP * S24[c]), np.exp(d * K_LIM * S24[c])
                hs = first(p <= stop) if d == 1 else first(p >= stop)
                hl = first(p >= lim) if d == 1 else first(p <= lim)
                m = (1 - stop) / (lim - stop)
                y = 1.0 if hl < hs else 0.0 if hs < hl else float(np.clip((p[-1] - stop) / (lim - stop), 0, 1))
                rows.append((c, d, s // SPD - 1, m, y, d * mu[s, c] / S24[c] / ALPHA))
    return np.array(rows)


def bucket(sig):
    return np.clip(np.digitize(sig, EDGES), 0, len(EDGES))


# calibration table from separate paths
tab_sum, tab_n = np.zeros(len(EDGES) + 1), np.zeros(len(EDGES) + 1)
for _ in range(12):
    x, mu = paths(DAYS)
    r = brackets(x, mu, DAYS)
    b = bucket(r[:, 5])
    np.add.at(tab_sum, b, r[:, 4]); np.add.at(tab_n, b, 1)
table = np.where(tab_n > 0, tab_sum / np.maximum(tab_n, 1), 1 / 3)


def boot(diff, day):
    days = int(day.max()) + 1
    by_day = [np.where(day == k)[0] for k in range(days)]
    nb = -(-days // BLOCK_D)
    out = []
    for _ in range(B):
        st = rng.integers(0, days, nb)
        out.append(diff[np.concatenate([by_day[(s + j) % days] for s in st for j in range(BLOCK_D)])].mean())
    return np.array(out)


passes, Ds, gaps = 0, [], []
for _ in range(W):
    x, mu = paths(DAYS)
    c, d, day, m, y, sig = brackets(x, mu, DAYS).T
    p = np.clip(table[bucket(sig)], .001, .999)
    diff = (m - y) ** 2 - (p - y) ** 2
    mc = m.copy()
    for k in np.unique(c * 10 + d):
        i = (c * 10 + d) == k
        mc[i] = np.clip(m[i] + (y[i] - m[i]).mean(), .001, .999)
    D, p05, Dc = diff.mean(), np.percentile(boot(diff, day), 5), ((mc - y) ** 2 - (p - y) ** 2).mean()
    passes += D > 0 and p05 > 0 and Dc > 0
    Ds.append(D); gaps.append(np.abs(p - m).mean())
print(f'seed {SEED}; alpha {ALPHA}; {W} windows of {DAYS} days; mean |p - m| {np.mean(gaps):.3f}; mean D {np.mean(Ds):+.4f}'
      f' (sd {np.std(Ds):.4f}); design B passes {passes / W:.2f}')
