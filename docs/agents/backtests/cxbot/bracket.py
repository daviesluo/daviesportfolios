"""CXBOT audit (2026-10-29), §5-§6: a bracket's outcome distribution under a martingale price (GBM), with a hold limit.

    python3 -I docs/agents/backtests/cxbot/bracket.py <stop frac> <limit frac> <annual vol> <hold days>

Shows: (1) E[y] = m when a timeout is scored at its fraction between stop and limit (optional stopping);
(2) P(limit first | resolved before T) < m, so excluding unresolved brackets biases y down and rewards shading p down.
"""
import numpy as np, sys

S0, dstop, dlim, sigma, days = 81200.0, 0.025, 0.05, 0.30, 3.0
if len(sys.argv) > 1:
    dstop, dlim, sigma, days = map(float, sys.argv[1:5])
L, U = S0 * (1 - dstop), S0 * (1 + dlim)
m = (S0 - L) / (U - L)
steps = int(days * 24 * 12)  # 5-minute steps
dt = days / 365 / steps
rng = np.random.default_rng(20261029)
shift = 0.5826 * sigma * np.sqrt(dt)  # Broadie-Glasserman continuity correction
Lc, Uc = np.log(L / S0) + shift, np.log(U / S0) - shift
paths = 200_000
hit_u = hit_l = 0
y_sum = 0.0
y_timeout = []
for chunk in range(10):
    k = paths // 10
    z = rng.standard_normal((k, steps), dtype=np.float32)
    x = np.cumsum((-0.5 * sigma ** 2 * dt) + sigma * np.sqrt(dt) * z, axis=1)
    up = x >= Uc
    dn = x <= Lc
    iu = np.where(up.any(1), up.argmax(1), steps + 1)
    il = np.where(dn.any(1), dn.argmax(1), steps + 1)
    u_first = iu < il
    l_first = il < iu
    none = (iu == steps + 1) & (il == steps + 1)
    hit_u += u_first.sum(); hit_l += l_first.sum()
    ST = S0 * np.exp(x[none, -1])
    yt = np.clip((ST - L) / (U - L), 0, 1)
    y_timeout.append(yt)
    y_sum += u_first.sum() + yt.sum()
yt = np.concatenate(y_timeout)
pu, pl, pn = hit_u / paths, hit_l / paths, len(yt) / paths
print(f'bracket: stop -{dstop:.1%}, limit +{dlim:.1%}, sigma {sigma:.0%}, hold {days:g} d; m = {m:.3f}')
print(f'P(limit first) {pu:.3f}  P(stop first) {pl:.3f}  P(neither by T) {pn:.3f}  E[y | neither] {yt.mean():.3f}')
print(f'E[y] with timeout at its fraction = {y_sum / paths:.4f} (m {m:.4f})')
print(f'P(limit first | resolved) = {pu / (pu + pl):.3f}  -> bias against m {pu / (pu + pl) - m:+.3f}')
