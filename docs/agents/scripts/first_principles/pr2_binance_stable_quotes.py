"""PR2 — resting quotes around the peg on Binance's USD-stablecoin pairs, as pre-registered in
prereg_binance_stable_quotes.md (frozen 2026-09-23T11:10:17Z, sha256 10d54246…). 1-minute year test.

usage: pr2_binance_stable_quotes.py <out.json>
"""
import gzip, json, sys, os, statistics as st, datetime, random, bisect
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from quote_sim import Params, run_book, exit_path, summarize

# Inputs: the committed copy beside the studies (docs/agents/backtests/inputs/first_principles_2026-09-23), read as .json.gz;
# FP_DATA names another folder of the same layout for a test whose inputs are not committed (PR1's hourly year, PR2's Binance year).
S = os.environ.get("FP_DATA") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../backtests/inputs/first_principles_2026-09-23")


def jload(path):
    """A JSON input, as fetched (.json) or as committed (.json.gz)."""
    if os.path.exists(path):
        return json.load(open(path))
    with gzip.open(path + ".gz", "rt") as f:
        return json.load(f)
H = 3600000
def ms(s): return int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
IS0, OOS0, OOS1 = ms("2025-09-11"), ms("2026-03-18"), ms("2026-09-23")
PRIMARY = ["USDCUSDT", "FDUSDUSDT", "TUSDUSDT", "USDPUSDT", "USD1USDT", "XUSDUSDT", "BFUSDUSDT", "USDEUSDT"]
SECONDARY = ["RLUSDUSDT", "USDSUSDT", "USDCUSD", "USDTUSD", "FDUSDUSDC", "USD1USDC", "USDEUSDC", "BFUSDUSDC"]
SPREAD_BPS = {"USDCUSDT": 0.10, "FDUSDUSDT": 1.00, "TUSDUSDT": 1.00, "USDPUSDT": 14.0, "USD1USDT": 0.10,
              "XUSDUSDT": 1.00, "BFUSDUSDT": 1.00, "USDEUSDT": 1.00, "RLUSDUSDT": 1.00, "USDCUSD": 0.10,
              "USDTUSD": 0.10, "FDUSDUSDC": 1.001, "USD1USDC": 1.001, "USDEUSDC": 1.00, "BFUSDUSDC": 11.001}
RUNGS = [0.0025, 0.005, 0.01, 0.02]


def ticks():
    d = jload(f"{S}/binance_exchangeInfo.json")
    out = {}
    for s in d["symbols"]:
        for f in s["filters"]:
            if f["filterType"] == "PRICE_FILTER":
                out[s["symbol"]] = float(f["tickSize"])
    return out


def load(p):
    rows = jload(f"{S}/binance_year/{p}_1m.json")
    return [(r[0], r[1], r[2], r[3], r[4], r[5], r[6]) for r in rows]


def fair_hourly(bars):
    traded = [(b[0], b[4]) for b in bars if b[5] > 0]
    tt = [t for t, _ in traded]
    hours = sorted({b[0] - b[0] % H for b in bars})
    out = {}
    for h in hours:
        lo = bisect.bisect_left(tt, h - 24 * H)
        hi = bisect.bisect_left(tt, h)
        w = [c for _, c in traded[lo:hi]]
        out[h] = st.median(w) if len(w) >= 60 else None
    return out


def run_pairs(pairs, bars, fairs, TK, fee=0.001, spread_mult=1.0, capacity=None):
    trips, orders, Ps = [], 0, {}
    for p in pairs:
        s_bps = SPREAD_BPS.get(p)
        if s_bps is None:
            s_bps = TK[p] / 1.0 * 1e4
        P = Params(RUNGS, 100.0, TK[p], fee, fee, s_bps * spread_mult / 2 / 1e4, 24 * H,
                   active_delay_bars=1, exit_delay_bars=1, capacity_frac=capacity, bar_ms=60000)
        tr, od = run_book(bars[p], fairs[p], lambda t: 1.0, P, p)
        trips += tr; orders += od; Ps[p] = P
    return trips, orders, Ps


def main():
    out_fn = sys.argv[1]
    TK = ticks()
    allp = PRIMARY + SECONDARY
    bars = {p: load(p) for p in allp}
    fairs = {p: fair_hourly(bars[p]) for p in allp}
    is_days = (OOS0 - IS0) / 86400000
    oos_days = (OOS1 - OOS0) / 86400000
    cap = len(PRIMARY) * 2 * len(RUNGS) * 100.0
    R = {"prereg": "prereg_binance_stable_quotes.md", "capital_usd": cap, "is_days": is_days, "oos_days": oos_days}
    arms = {"primary": dict(), "stress": dict(fee=0.002, spread_mult=2.0), "capacity_10pct": dict(capacity=0.10)}
    for name, kw in arms.items():
        trips, orders, Ps = run_pairs(PRIMARY, bars, fairs, TK, **kw)
        R[name] = {"IS": summarize(trips, IS0, OOS0, cap, days=is_days), "OOS": summarize(trips, OOS0, OOS1, cap, days=oos_days),
                   "orders_per_day": round(orders / ((OOS1 - IS0) / 86400000), 1)}
        if name == "primary":
            trips_p, Ps_p = trips, Ps
            R[name]["OOS_by_pair"] = {p: summarize([x for x in trips if x["book"] == p], OOS0, OOS1, cap / len(PRIMARY), days=oos_days) for p in PRIMARY}
            R[name]["IS_by_pair"] = {p: summarize([x for x in trips if x["book"] == p], IS0, OOS0, cap / len(PRIMARY), days=is_days) for p in PRIMARY}
            R[name]["OOS_by_rung"] = {f"k={k*100:g}%": summarize([x for x in trips if x["k"] == k], OOS0, OOS1, cap / 4, days=oos_days) for k in RUNGS}
            R[name]["IS_by_rung"] = {f"k={k*100:g}%": summarize([x for x in trips if x["k"] == k], IS0, OOS0, cap / 4, days=is_days) for k in RUNGS}
            R[name]["OOS_by_side"] = {s: summarize([x for x in trips if x["side"] == s], OOS0, OOS1, cap / 2, days=oos_days) for s in ("bid", "ask")}
    # secondary pairs, descriptive
    trips_s, orders_s, _ = run_pairs(SECONDARY, bars, fairs, TK)
    R["secondary"] = {p: {"IS": summarize([x for x in trips_s if x["book"] == p], IS0, OOS0, 800.0, days=is_days),
                          "OOS": summarize([x for x in trips_s if x["book"] == p], OOS0, OOS1, 800.0, days=oos_days)} for p in SECONDARY}
    # null
    rng = random.Random(20260923)
    oos_trips = sorted([x for x in trips_p if OOS0 <= x["t_entry"] < OOS1], key=lambda z: (z["book"], z["t_entry"], z["side"], z["k"]))
    pools = {p: [i for i, r in enumerate(bars[p]) if OOS0 <= r[0] < OOS1 and r[5] > 0] for p in PRIMARY}
    cache, draws = {}, []
    for d in range(2000):
        tot = 0.0
        for x in oos_trips:
            p = x["book"]
            i = pools[p][rng.randrange(len(pools[p]))]
            key = (p, i, x["side"])
            if key not in cache:
                cache[key] = exit_path(bars[p], i, x["side"], bars[p][i][4], fairs[p], Ps_p[p], lambda t: 1.0, 100.0)
            v = cache[key]
            tot += v if v is not None else 0.0
        draws.append(tot)
    draws.sort()
    p95 = draws[int(0.95 * (len(draws) - 1))]
    prim = R["primary"]["OOS"]["pnl_usd"]
    R["null_random_time"] = {"draws": len(draws), "mean": round(st.mean(draws), 4), "p05": round(draws[int(0.05 * 1999)], 4),
                             "p50": round(draws[1000], 4), "p95": round(p95, 4),
                             "share_draws_ge_primary": round(sum(1 for x in draws if x >= prim) / len(draws), 4)}
    R["bar"] = {"1_primary_oos_gt_0": prim > 0, "2_primary_oos_gt_null_p95": prim > p95,
                "3_stress_oos_gt_0": R["stress"]["OOS"]["pnl_usd"] > 0, "4_capacity_oos_gt_0": R["capacity_10pct"]["OOS"]["pnl_usd"] > 0}
    R["bar"]["PASS"] = all(R["bar"].values())
    R["oos_trips"] = [{k: (round(v, 6) if isinstance(v, float) else v) for k, v in x.items()} for x in oos_trips]
    json.dump(R, open(out_fn, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
