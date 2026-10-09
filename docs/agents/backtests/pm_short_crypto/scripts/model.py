"""The fair price of "Up" for a Polymarket BTC 5m/15m market, and the Binance 1 s series it is computed from.

Resolution (measured, results/h0_resolution.json): Up iff TWAP60(end) >= TWAP60(start), where TWAP60(t) is Chainlink's
BTC/USD 60-second TWAP stream at t (each window's priceToBeat IS the previous window's finalPrice on all 2,678 pairs).
In Binance space at second t of a window [s, e], with S_t the price, K = mean(S over (s-60, s]) and tau = e - t:
  tau >= 60: F - S_t ~ N(0, var_s * S^2 * (tau - 40))           (the 60 s average at e, seen from tau before it)
  tau <  60: F = (A + tau * S_t)/60 + noise, A = sum of S over (e-60, t]; sd = sigma * S * sqrt(tau^3 / 3) / 60
P(Up) = Phi((E[F] - K) / sd). var_s, the variance a second, is k times the 1 s realised variance of the last 1,800 s."""
import gzip, json, math
from bisect import bisect_right

def load_binance(path):
    d = json.load(gzip.open(path, "rt"))
    t0, c = d["t0"], d["close"]
    pre = [0.0]
    for x in c: pre.append(pre[-1] + x)
    r2 = [0.0]
    for i in range(1, len(c)):
        r = math.log(c[i] / c[i - 1]); r2.append(r2[-1] + r * r)
    r2.append(r2[-1])
    return {"t0": t0, "c": c, "pre": pre, "r2": r2}

def px(B, t):  # close of second t (the price known at the end of second t)
    return B["c"][t - B["t0"]]

def mean_over(B, a, b):  # mean close over seconds (a, b]
    i, j = a - B["t0"] + 1, b - B["t0"] + 1
    return (B["pre"][j] - B["pre"][i]) / (b - a)

def rv1(B, t, look=1800):  # realised variance a second over (t - look, t]
    i, j = t - B["t0"] - look + 1, t - B["t0"] + 1
    return (B["r2"][j] - B["r2"][i]) / look

def Phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

def fair_up(B, s, e, t, k):
    """P(Up) at the end of second t of window [s, e], Binance-space, variance multiplier k."""
    K = mean_over(B, s - 60, s)
    S = px(B, t); tau = e - t
    v = k * rv1(B, t)
    if tau <= 0:
        F = mean_over(B, e - 60, e); return 1.0 if F >= K else 0.0
    if tau >= 60:
        mu, sd = S, S * math.sqrt(v * (tau - 40))
    else:
        A = mean_over(B, e - 60, t) * (t - (e - 60))
        mu = (A + tau * S) / 60; sd = S * math.sqrt(v * tau ** 3 / 3) / 60
    if sd <= 0: return 1.0 if mu >= K else 0.0
    return Phi((mu - K) / sd)

def fee(p, rate=0.07):  # a taker's fee a share: rate * p * (1 - p) (pm_fees.ts, exponent 1)
    return rate * p * (1 - p)
