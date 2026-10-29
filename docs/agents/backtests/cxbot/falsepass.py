"""CXBOT audit (2026-10-29), docs/agents/reviews/2026-10-29-crypto-grok-bot-audit.md §5: how often does a forecaster
with NO skill pass each scoring design, on simulated martingale paths of three correlated coins?

    python3 -I docs/agents/backtests/cxbot/falsepass.py [windows] [seed] [stop_sd] [limit_sd]

Paths: BTC, ETH, SOL at 5-minute steps, annual vol 40 / 55 / 70 %, correlations 0.75-0.8, the price a martingale (log
drift -sigma^2/2). Every 4 hours, for each coin, a long and a short bracket from the price then: stop `stop_sd` and limit
`limit_sd` one-day standard deviations away, held at most 3 days. A window is 42 days (1,512 brackets).

Design A (IGBOT's draft reading as of 2026-10-29): a bracket neither side reaches within the hold is EXCLUDED; the
bootstrap resamples brackets; D_c moves the baseline by one constant, mean(y - m). Pass: n >= 150, D > 0, its 5th
percentile > 0, D_c > 0.
Design B (this audit, CXBOT's prereg): a bracket that times out scores y = where the price stands between stop (0) and
limit (1), clipped; the bootstrap resamples circular blocks of 3 consecutive days; D_c moves the baseline per (coin,
direction) cell. Pass: D > 0, its 5th percentile > 0, D_c > 0.

Forecasters (none has skill: the paths are martingales):
  disagree10  p = m +/- 0.10 at random (how wide D's sampling error is for a 10-point disagreement);
  shader      p = P(limit first | the bracket resolves), estimated from the volatility alone;
  bull        long p = m + 0.10, short p = m - 0.05;
  chaser      p = m + 0.08 with the last 24 hours' move, m - 0.08 against it.
"""
import sys
import numpy as np

W = int(sys.argv[1]) if len(sys.argv) > 1 else 200
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 20261029
K_STOP = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
K_LIM = float(sys.argv[4]) if len(sys.argv) > 4 else 2.0
rng = np.random.default_rng(SEED)
DAYS, HOLD_D, STEP_MIN, BLOCK_D, B = 42, 3, 5, 3, 400
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
    """Rows: coin, direction, start day, m, y (timeout at its fraction), y_resolved (nan if neither), last 24 h move."""
    rows = []
    for c in range(3):
        for s in range(SPD, (DAYS + 1) * SPD, EVERY):
            p = np.exp(x[s:s + HOLD + 1, c] - x[s, c])
            for d in (1, -1):
                stop, lim = np.exp(-d * K_STOP * S24[c]), np.exp(d * K_LIM * S24[c])
                hit_stop = first(p <= stop) if d == 1 else first(p >= stop)
                hit_lim = first(p >= lim) if d == 1 else first(p <= lim)
                m = (1 - stop) / (lim - stop)
                if hit_lim < hit_stop:
                    y, yr = 1.0, 1.0
                elif hit_stop < hit_lim:
                    y, yr = 0.0, 0.0
                else:
                    y, yr = float(np.clip((p[-1] - stop) / (lim - stop), 0, 1)), np.nan
                rows.append((c, d, s // SPD - 1, m, y, yr, x[s, c] - x[s - SPD, c]))
    return np.array(rows)


def boot(diff, day):
    if day is None:
        return np.array([diff[rng.integers(0, len(diff), len(diff))].mean() for _ in range(B)])
    days = int(day.max()) + 1
    by_day = [np.where(day == k)[0] for k in range(days)]
    nb = -(-days // BLOCK_D)
    out = []
    for _ in range(B):
        starts = rng.integers(0, days, nb)
        idx = np.concatenate([by_day[(s + j) % days] for s in starts for j in range(BLOCK_D)])
        out.append(diff[idx].mean())
    return np.array(out)


def score(p, m, y, day, cells):
    p, m = np.clip(p, .001, .999), np.clip(m, .001, .999)
    diff = (m - y) ** 2 - (p - y) ** 2
    mc = m.copy()
    for k in np.unique(cells):
        i = cells == k
        mc[i] = np.clip(m[i] + (y[i] - m[i]).mean(), .001, .999)
    return diff.mean(), np.percentile(boot(diff, day), 5), ((mc - y) ** 2 - (p - y) ** 2).mean()


ref = brackets(paths())
shade = float(np.nanmean(ref[:, 5]))
unres = float(np.isnan(ref[:, 5]).mean())
names = ['disagree10', 'shader', 'bull', 'chaser']
res = {k: {'A': 0, 'B': 0, 'DA': [], 'DB': []} for k in names}
for _ in range(W):
    c, d, day, m, y, yr, r24 = brackets(paths()).T
    fc = {
        'disagree10': m + rng.choice([-.1, .1], len(m)),
        'shader': np.full(len(m), shade),
        'bull': np.where(d == 1, m + .10, m - .05),
        'chaser': np.where(np.sign(r24) == d, m + .08, m - .08),
    }
    ok = ~np.isnan(yr)
    for k, p in fc.items():
        a = score(p[ok], m[ok], yr[ok], None, np.zeros(ok.sum()))
        b = score(p, m, y, day, c * 10 + d)
        res[k]['A'] += ok.sum() >= 150 and a[0] > 0 and a[1] > 0 and a[2] > 0
        res[k]['B'] += b[0] > 0 and b[1] > 0 and b[2] > 0
        res[k]['DA'].append(a[0]); res[k]['DB'].append(b[0])
print(f'seed {SEED}; {W} windows of {DAYS} days, {len(m)} brackets each; stop {K_STOP} sd, limit {K_LIM} sd, hold {HOLD_D} d;'
      f' m = {K_STOP / (K_STOP + K_LIM):.3f}; unresolved {unres:.2f}; P(limit first | resolved) {shade:.3f}')
for k in names:
    r = res[k]
    print(f'  {k:11s} design A: pass {r["A"] / W:.3f}, mean D {np.mean(r["DA"]):+.4f}, sd D {np.std(r["DA"]):.4f}'
          f' | design B: pass {r["B"] / W:.3f}, mean D {np.mean(r["DB"]):+.4f}, sd D {np.std(r["DB"]):.4f}')
