# Data QA before the pre-registration is frozen. Reads only the parsed daily
# klines ($S/binance_klines/daily/*.json) and the saved keyless exchangeInfo;
# computes NO strategy return. Prints: per-symbol spans, the gap distribution
# inside each series, candidates for the stablecoin / pegged / leveraged
# exclusion lists, pairs whose closes sit near $1, tokenised-stock spans, and
# how many pairs would be eligible over time under the draft universe rule.
import json, os, sys, glob, datetime, statistics, collections

S = os.environ.get("XSMOM_WORK") or sys.exit("set XSMOM_WORK to a working directory: binance_klines/ lives under it")
K = f"{S}/binance_klines"
day = lambda t: t // 86400
iso = lambda d: datetime.datetime.fromtimestamp(d * 86400, datetime.timezone.utc).strftime("%Y-%m-%d")

series = {}
for p in sorted(glob.glob(f"{K}/daily/*.json")):
    sym = os.path.basename(p)[:-5]
    rows = json.load(open(p))
    series[sym] = rows
print(f"{len(series)} series")

# The exchangeInfo snapshot the study read: gunzip docs/agents/backtests/inputs/binance_exchangeInfo_2026-09-23.json.gz
ex = json.load(open(os.environ.get("XSMOM_XINFO") or f"{S}/exchangeInfo.json"))
status = {s["symbol"]: s["status"] for s in ex["symbols"]}

# 1. gaps inside each series (days between consecutive rows minus one)
gaps = collections.Counter()
big = []
for sym, rows in series.items():
    ds = [day(r[0]) for r in rows]
    for a, b in zip(ds, ds[1:]):
        g = b - a - 1
        if g > 0:
            gaps[g] += 1
            if g >= 2:
                big.append((g, sym, iso(a), iso(b)))
print("gap histogram (missing days: count):", sorted(gaps.items())[:40])
big.sort(reverse=True)
print("gaps of >= 2 missing days:", len(big))
for g in big[:80]:
    print("  ", g)

# 2. last day per series vs the archive end, and exchangeInfo status
last_all = max(day(r[-1][0]) for r in series.values())
print("archive last day:", iso(last_all))
ended = [(s, iso(day(r[-1][0])), status.get(s, "absent")) for s, r in series.items() if day(r[-1][0]) < last_all]
print("series ending before the archive end:", len(ended))
cnt = collections.Counter(st for _, _, st in ended)
print("  their exchangeInfo status:", cnt)
live_break = [(s, st) for s, r in series.items() if day(r[-1][0]) == last_all and status.get(s) != "TRADING"]
print("series reaching the end but not TRADING:", live_break)

# 3. near-$1 closes (stablecoin screen)
near1 = []
for s, r in series.items():
    cl = [x[4] for x in r]
    share = sum(1 for c in cl if 0.95 <= c <= 1.05) / len(cl)
    if share >= 0.5:
        near1.append((round(share, 3), s, len(cl), iso(day(r[0][0])), iso(day(r[-1][0]))))
near1.sort(reverse=True)
print("series with >= 50 % of closes in [0.95, 1.05]:")
for x in near1:
    print("  ", x)

# 4. spans of symbols ending in B that look like tokenised stocks
for s in sorted(series):
    b = s[:-4]
    if b.endswith("B") and len(b) >= 4:
        r = series[s]
        print("  B-suffix", s, iso(day(r[0][0])), iso(day(r[-1][0])), len(r))
