"""L1: who leads whom, on the live recording. Each feed is put on a 100 ms grid by RECEIVE time (the last value seen
by then); the correlation of 1 s changes of feed A with 1 s changes of feed B shifted by a lag says how far B trails
A. Feeds: Coinbase ticker (cb), Kraken best bid/ask mid (kr), Binance via Polymarket's RTDS (bn), Chainlink BTC/USD via
RTDS (cl), and Polymarket's Up mid of the current 5m window (pm5, converted to a price move through the model's delta
is not needed: the correlation of signs of change is read). Added on Davies' word (2026-10-09): Binance spot bookTicker (bs), Binance USD-M perp bookTicker (bf), Hyperliquid's
perp best bid/offer (hb), its mark (hm) and oracle (ho) prices, from recorder2.py's file (ref2), read from where it
overlaps the others. Usage: l1_leadlag.py ref.jsonl clob.jsonl out.json [ref2.jsonl]"""
import json, sys, math, bisect
ref = [json.loads(l) for l in open(sys.argv[1])]; clob = [json.loads(l) for l in open(sys.argv[2])]
series = {"cb": [], "kr": [], "bn": [], "cl": []}
if len(sys.argv) > 4:
    for k in ("bs", "bf", "hb", "hm", "ho"): series[k] = []
    for l in open(sys.argv[4]):
        r = json.loads(l)
        if r["k"] in ("bs", "bf", "hb"): series[r["k"]].append((r["t"], (r["b"] + r["a"]) / 2))
        elif r["k"] == "hc": series["hm"].append((r["t"], r["mark"])); series["ho"].append((r["t"], r["oracle"]))
for r in ref:
    if r["k"] == "cb": series["cb"].append((r["t"], r["p"]))
    elif r["k"] == "kr" and r.get("b") and r.get("a"): series["kr"].append((r["t"], (r["b"] + r["a"]) / 2))
    elif r["k"] in ("bn", "cl"): series[r["k"]].append((r["t"], r["p"]))
# Polymarket: the current 5m window's Up mid, as a series of "window-relative" mids; changes across a window roll are dropped
pm = []
for r in clob:
    if r["k"] == "bk" and "-5m-" in r["m"] and r["bb"] and r["ba"]:
        s = int(r["m"].rsplit("-", 1)[1])
        if s * 1000 <= r["t"] < (s + 300) * 1000: pm.append((r["t"], (r["bb"][0][0] + r["ba"][0][0]) / 2, s))
t0 = min(v[0][0] for v in series.values() if v); t1 = max(v[-1][0] for v in series.values() if v)
grid = list(range(t0 + 2000, t1 - 2000, 100))
def on_grid(v, stale=5000):
    # None where the feed's newest value is over 5 s old (a recording gap; Chainlink and the RTDS feeds tick each second)
    ts = [x[0] for x in v]; out = []
    for g in grid:
        i = bisect.bisect_right(ts, g) - 1; out.append(v[i][1] if i >= 0 and g - v[i][0] <= stale else None)
    return out
# Coinbase, Kraken and the RTDS feeds tick every second at least; the mid-change-only feeds may rest longer
G = {k: on_grid(v, 5000 if k in ("cb", "kr", "bn", "cl") else 60000) for k, v in series.items()}
pts = [x[0] for x in pm]
G["pm5"] = []; win = []
for g in grid:
    i = bisect.bisect_right(pts, g) - 1
    ok = i >= 0 and g - pm[i][0] <= 10000
    G["pm5"].append(pm[i][1] if ok else None); win.append(pm[i][2] if ok else None)
def corr(a, b):
    n = len(a); ma = sum(a) / n; mb = sum(b) / n
    sa = math.sqrt(sum((x - ma) ** 2 for x in a)); sb = math.sqrt(sum((y - mb) ** 2 for y in b))
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (sa * sb) if sa and sb else float("nan")
H = 10  # 1 s changes on the 100 ms grid
def d(k, i):
    a, b = G[k][i], G[k][i - H]
    if a is None or b is None: return None
    if k == "pm5":
        return a - b if win[i] == win[i - H] else None
    return math.log(a / b)
out = {"grid_seconds": len(grid) / 10, "pairs": {}}
PAIRS = [("cb", "kr"), ("cb", "bn"), ("cb", "cl"), ("bn", "cl"), ("cb", "pm5"), ("bn", "pm5"), ("cl", "pm5")]
if "bs" in series:
    PAIRS += [("bf", "bs"), ("bf", "cb"), ("bs", "cb"), ("bf", "hb"), ("hb", "cb"), ("bf", "cl"), ("bs", "cl"), ("hb", "cl"), ("hm", "cl"), ("ho", "cl"),
              ("bf", "hm"), ("bf", "ho"), ("bf", "pm5"), ("bs", "pm5"), ("hb", "pm5"), ("hm", "pm5")]
for A, Bk in PAIRS:
    res = {}
    for lag in range(-20, 61, 2):  # B shifted by lag x 100 ms
        xs, ys = [], []
        for i in range(H + 40, len(grid) - 70, 5):
            a = d(A, i); b = d(Bk, i + lag)
            if a is None or b is None: continue
            xs.append(a); ys.append(b)
        res[lag * 100] = round(corr(xs, ys), 4)
    best = max(res, key=lambda k: res[k])
    out["pairs"][f"{A}->{Bk}"] = {"corr_by_lag_ms": res, "peak_lag_ms": best, "peak_corr": res[best]}
json.dump(out, open(sys.argv[3], "w"), indent=1, sort_keys=True)
for k, v in out["pairs"].items(): print(k, v["peak_lag_ms"], v["peak_corr"], {l: v["corr_by_lag_ms"][l] for l in (-1000, -400, 0, 400, 1000, 2000, 3000)})
