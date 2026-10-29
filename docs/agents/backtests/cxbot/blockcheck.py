"""CXBOT independent audit (2026-10-29), docs/agents/reviews/2026-10-29-cxbot-independent-audit.md §2: is layer A's 3-day
block bootstrap wide enough when a forecaster's luck runs in spells longer than a block?

    python3 -I docs/agents/backtests/cxbot/blockcheck.py [windows] [seed]

The world is `falsepass.py`'s (three correlated martingale coins, 5-minute steps, 1 and 2 day-sd brackets every 4 hours,
72-hour hold, y at its fraction on a timeout) over the prereg's 56 days. The forecasters have NO skill: each holds a
"macro view" (bull or bear, common to the three coins) that flips at random every L days, and leans p by delta toward it
(long m + delta, short m - delta in a bull spell; the mirror in a bear one). Each loses delta^2 of Brier on average, but
its luck is correlated over L days. For each: the share of windows that PASS (D > 0, the bootstrap's 5th percentile > 0,
D_c > 0), the sd of D across windows, and the mean sd the bootstrap estimates. A bootstrap narrower than the true spread is
anti-conservative.
"""
import sys
import numpy as np

W = int(sys.argv[1]) if len(sys.argv) > 1 else 200
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 20261029
rng = np.random.default_rng(SEED)
DAYS, HOLD_D, STEP_MIN, B = 56, 3, 5, 400
SPD = 24 * 60 // STEP_MIN
HOLD = HOLD_D * SPD
EVERY = 4 * 60 // STEP_MIN
SIG = np.array([0.40, 0.55, 0.70])
CH = np.linalg.cholesky(np.array([[1, .8, .75], [.8, 1, .8], [.75, .8, 1]]))
DT = 1 / 365 / SPD
S24 = SIG * np.sqrt(1 / 365)
NONE = 10 ** 9


def paths():
    z = rng.standard_normal(((DAYS + HOLD_D + 1) * SPD, 3)) @ CH.T
    return np.vstack([np.zeros(3), np.cumsum(-0.5 * SIG ** 2 * DT + SIG * np.sqrt(DT) * z, axis=0)])


def first(mask):
    return int(np.argmax(mask)) if mask.any() else NONE


def brackets(x):
    rows = []
    for c in range(3):
        for s in range(SPD, (DAYS + 1) * SPD, EVERY):
            p = np.exp(x[s:s + HOLD + 1, c] - x[s, c])
            for d in (1, -1):
                stop, lim = np.exp(-d * S24[c]), np.exp(2 * d * S24[c])
                hs = first(p <= stop) if d == 1 else first(p >= stop)
                hl = first(p >= lim) if d == 1 else first(p <= lim)
                m = (1 - stop) / (lim - stop)
                y = 1.0 if hl < hs else 0.0 if hs < hl else float(np.clip((p[-1] - stop) / (lim - stop), 0, 1))
                rows.append((c, d, s // SPD - 1, s / SPD - 1, m, y))
    return np.array(rows)


def boot(diff, day, block):
    days = int(day.max()) + 1
    by_day = [np.where(day == k)[0] for k in range(days)]
    nb = -(-days // block)
    out = np.empty(B)
    for b in range(B):
        starts = rng.integers(0, days, nb)
        idx = np.concatenate([by_day[(s + j) % days] for s in starts for j in range(block)])
        out[b] = diff[idx].mean()
    return out


def score(p, m, y, day, cells, block):
    p, m = np.clip(p, .001, .999), np.clip(m, .001, .999)
    diff = (m - y) ** 2 - (p - y) ** 2
    mc = m.copy()
    for k in np.unique(cells):
        i = cells == k
        mc[i] = np.clip(m[i] + (y[i] - m[i]).mean(), .001, .999)
    bt = boot(diff, day, block)
    return diff.mean(), np.percentile(bt, 5), ((mc - y) ** 2 - (p - y) ** 2).mean(), bt.std()


SPECS = [(L, dl) for L in (3, 7, 14) for dl in (0.03, 0.06)]
BLOCKS = (3, 7)
res = {(L, dl, bl): {'pass': 0, 'D': [], 'bsd': []} for L, dl in SPECS for bl in BLOCKS}
for _ in range(W):
    c, d, day, tday, m, y = brackets(paths()).T
    for L, dl in SPECS:
        spells = rng.choice([-1.0, 1.0], int(DAYS / L) + 2)
        view = spells[(tday // L).astype(int)]
        p = m + dl * view * d
        for bl in BLOCKS:
            D, p05, dc, bsd = score(p, m, y, day, c * 10 + d, bl)
            r = res[(L, dl, bl)]
            r['pass'] += D > 0 and p05 > 0 and dc > 0
            r['D'].append(D); r['bsd'].append(bsd)
print(f'seed {SEED}; {W} windows of {DAYS} days, {len(m)} brackets each; no skill; a view that flips every L days')
for (L, dl, bl), r in res.items():
    print(f'  L {L:2d} d, delta {dl:.2f}, block {bl} d: pass {r["pass"] / W:.3f}; mean D {np.mean(r["D"]):+.5f}; '
          f'sd of D across windows {np.std(r["D"]):.5f}; mean bootstrap sd {np.mean(r["bsd"]):.5f}')
