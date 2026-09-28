# E[chase | miss] for a resting order at the same side's touch, crossed at 60 minutes if no trade went through it.
# Binance 1-minute klines (trade prices), every hour close 2026-07-01 -> 2026-09-27, spread s either side of the mid.
import gzip, json, random, statistics as st
S_BPS = 2.0                 # a Revolut X major's touch spread (reference: <= 3 bps)
def run(sym):
    rows = json.load(gzip.open(f"{sym}_1m.json.gz", "rt"))
    by = {r[0]: r for r in rows}
    out = {"buy": [], "sell": []}; n = {"buy": 0, "sell": 0}
    for t0 in sorted(k for k in by if k % 3600000 == 0 and k < 1790553600000):   # hour closes before 09-28 00:00
        mins = [by.get(t0 + 60000 * i) for i in range(61)]
        if any(m is None for m in mins): continue
        m0 = mins[0][1]                          # the open of the decision minute: the mid at t0
        mT = mins[60][1]                         # the open of the minute 60 later: the mid at the cross
        lo = min(m[3] for m in mins[:60]); hi = max(m[2] for m in mins[:60])
        h = S_BPS / 2 / 1e4
        # buy: rest at P = bid, K = ask; filled iff a trade went strictly below P before the cross
        P, K = m0 * (1 - h), m0 * (1 + h); n["buy"] += 1
        if not lo < P: out["buy"].append((mT * (1 + h) - K) / K * 1e4)
        P, K = m0 * (1 + h), m0 * (1 - h); n["sell"] += 1
        if not hi > P: out["sell"].append((K - mT * (1 - h)) / K * 1e4)
    return out, n
rng = random.Random(1)
allc = {"buy": [], "sell": []}
for sym in ["BTCUSDT", "ETHUSDT", "SOLUSDT"]:
    out, n = run(sym)
    for side in ("buy", "sell"):
        c = out[side]; allc[side] += c
        boots = sorted(st.mean(rng.choices(c, k=len(c))) for _ in range(4000)) if len(c) > 1 else [float("nan")]
        print(f"{sym} {side}: hours {n[side]}, misses {len(c)} ({100*len(c)/n[side]:.1f} %), mean chase {st.mean(c):.1f} bps, "
              f"median {st.median(c):.1f}, 97.5% upper of mean {boots[int(0.975*len(boots))]:.1f}, p90 {sorted(c)[int(0.9*len(c))]:.1f}")
for side in ("buy", "sell"):
    c = allc[side]; print(f"ALL {side}: misses {len(c)}, mean {st.mean(c):.1f}, median {st.median(c):.1f}")
