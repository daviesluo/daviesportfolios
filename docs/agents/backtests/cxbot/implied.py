"""CXBOT audit (2026-10-29), §6: Deribit-implied probabilities for Polymarket's BTC questions (keyless reads).

    python3 -I docs/agents/backtests/cxbot/implied.py

The question dates are written in for the audit's run (2026-10-29 00:20 UTC); edit them to re-run another day.

Digital P(S_T > K) from the smile: -dC/dK = N(d2) - K n(d2) sqrt(T) dsigma/dK (undiscounted, forward measure).
Touch P(max S_t >= K before T) ~ driftless reflection on the log price with the strike's own vol.
"""
import json, subprocess, time, math
from datetime import datetime, timezone

N = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
n = lambda x: math.exp(-x * x / 2) / math.sqrt(2 * math.pi)


def get(url):
    return json.loads(subprocess.check_output(['curl', '-s', '-m', '30', url]))


now = time.time()
bs = get('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option')['result']
ins = {i['instrument_name']: i for i in get('https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false')['result']}
smiles = {}
for b in bs:
    i = ins.get(b['instrument_name'])
    if not i or b.get('mark_iv') is None or i['option_type'] != 'call':
        continue
    smiles.setdefault(i['expiration_timestamp'] / 1000, {})[i['strike']] = (b['mark_iv'] / 100, b['underlying_price'])
exps = sorted(smiles)


def iv_at(exp, K):
    pts = sorted(smiles[exp].items())
    ks = [k for k, _ in pts]
    if K <= ks[0]: return pts[0][1][0]
    if K >= ks[-1]: return pts[-1][1][0]
    for (k1, (v1, _)), (k2, (v2, _)) in zip(pts, pts[1:]):
        if k1 <= K <= k2:
            return v1 + (v2 - v1) * (K - k1) / (k2 - k1)


def fwd(exp):
    return list(smiles[exp].values())[0][1]


def iv_T(t_end, K):
    """Total-variance interpolation between the two Deribit expiries around t_end, by strike."""
    T = (t_end - now) / (365 * 86400)
    a = max(e for e in exps if e <= t_end) if any(e <= t_end for e in exps) else exps[0]
    b = min(e for e in exps if e >= t_end)
    Ta, Tb = (a - now) / (365 * 86400), (b - now) / (365 * 86400)
    va, vb = iv_at(a, K) ** 2 * Ta, iv_at(b, K) ** 2 * Tb
    w = 0 if b == a else (T - Ta) / (Tb - Ta)
    F = fwd(a) + (fwd(b) - fwd(a)) * w
    return math.sqrt(max(1e-12, (va + (vb - va) * w) / T)), T, F


def digital(t_end, K):
    s, T, F = iv_T(t_end, K)
    h = 50.0
    s_up, _, _ = iv_T(t_end, K + h); s_dn, _, _ = iv_T(t_end, K - h)
    dsdk = (s_up - s_dn) / (2 * h)
    d2 = (math.log(F / K) - 0.5 * s * s * T) / (s * math.sqrt(T))
    return N(d2) - K * n(d2) * math.sqrt(T) * dsdk, s, T, F


def touch_up(t_end, K):
    s, T, F = iv_T(t_end, K)
    x = math.log(K / F) / (s * math.sqrt(T))
    return 2 * (1 - N(x)), s  # driftless reflection on log price (upper)


def touch_dn(t_end, K):
    s, T, F = iv_T(t_end, K)
    x = math.log(F / K) / (s * math.sqrt(T))
    return 2 * (1 - N(x)), s


print('ts', datetime.now(timezone.utc).isoformat(timespec='seconds'))
t30 = datetime(2026, 10, 30, 16, 0, tzinfo=timezone.utc).timestamp()
print('Above K on Oct 30 16:00 UTC (Polymarket resolves on Binance BTC/USDT close):')
for K in (78000, 80000, 82000, 84000, 86000):
    p, s, T, F = digital(t30, K)
    print(f'  K {K}: Deribit digital {p:.3f} (iv {s:.3f}, T {T*365:.2f} d, F {F:.0f})')
twk = datetime(2026, 11, 2, 4, 59, tzinfo=timezone.utc).timestamp()
print('Touch by Nov 2 04:59 UTC (weekly "hit" market):')
for K in (82000, 84000, 86000, 88000):
    p, s = touch_up(twk, K); print(f'  up {K}: {p:.3f} (iv {s:.3f})')
for K in (78000, 76000, 74000):
    p, s = touch_dn(twk, K); print(f'  down {K}: {p:.3f} (iv {s:.3f})')
