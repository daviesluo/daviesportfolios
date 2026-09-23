"""PR1 — resting quotes around fair value on Revolut X's four stablecoin books (UK), as pre-registered in
prereg_revx_stable_quotes.md (frozen 2026-09-23T11:09:20Z, sha256 067a0061…). Hourly year test, plus the
descriptive 1-minute replay of the last 28 days.

usage: pr1_revx_stable_quotes.py <out.json>
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
OOS0, OOS1 = ms("2026-03-18"), ms("2026-09-23")
IS0 = ms("2025-09-11")
BOOKS = ["USDC-USD", "USDT-USD", "USDC-GBP", "USDT-GBP"]
SPREAD_BPS = {"USDC-USD": 1.00, "USDT-USD": 2.00, "USDC-GBP": 1.33, "USDT-GBP": 1.33}
TICK = 0.0001
RUNGS = [0.0025, 0.005, 0.01, 0.02]
CAPITAL = 4 * 2 * 4 * 100.0


def load_hourly(sym):
    rows = jload(f"{S}/revx_hist/{sym}_60m.json")
    return [(r[0], r[1], r[2], r[3], r[4], r[5], r[5] * r[4]) for r in rows]


def build_fx_btc(bu, bg, step):
    """X at each hour start h: BTC/USD close / BTC/GBP close of the latest bar <= h-step in which both
    traded, not older than h-3h."""
    U = {r[0]: r for r in bu}; G = {r[0]: r for r in bg}
    both = sorted(t for t in U if t in G and U[t][5] > 0 and G[t][5] > 0)
    def X(h):
        i = bisect.bisect_right(both, h - step) - 1
        if i < 0: return None
        t = both[i]
        if t < h - 3 * H: return None
        return U[t][4] / G[t][4]
    return X


def build_fx_yahoo():
    Y = sorted((r[0], r[4]) for r in jload(f"{S}/ref/yahoo_GBPUSD_1h.json"))
    YT = [t for t, _ in Y]
    def X(h):
        i = bisect.bisect_right(YT, h - H) - 1
        return Y[i][1] if i >= 0 else None
    return X


def fair_usd_series(bars, hours, min_n, step):
    """fairU at each hour start: median close of traded bars in [h-24h, h-step]."""
    traded = [(b[0], b[4]) for b in bars if b[5] > 0]
    tt = [t for t, _ in traded]
    out = {}
    for h in hours:
        lo = bisect.bisect_left(tt, h - 24 * H)
        hi = bisect.bisect_right(tt, h - step)
        w = [c for _, c in traded[lo:hi]]
        out[h] = st.median(w) if len(w) >= min_n else None
    return out


def run(bars_by_book, fx, P_base, step, min_n, capacity=None, through=0, taker_mult=1.0, spread_mult=1.0):
    trips_all, orders_all, fairs = [], 0, {}
    for b in BOOKS:
        bars = bars_by_book[b]
        hours = sorted({t - t % H for t, *_ in bars})
        s_ = b.split("-")[0]
        fu = fair_usd_series(bars_by_book[f"{s_}-USD"], hours, min_n, step)
        if b.endswith("GBP"):
            fair = {}
            for h in hours:
                x = fx(h)
                fair[h] = (fu[h] / x) if (fu.get(h) and x) else None
            usdq = lambda t, fx=fx, step=step: fx(t + step) or fx(t)
        else:
            fair = fu
            usdq = lambda t: 1.0
        P = Params(RUNGS, 100.0, TICK, 0.0, 0.0009 * taker_mult, SPREAD_BPS[b] * spread_mult / 2 / 1e4, 24 * H,
                   active_delay_bars=P_base["active"], exit_delay_bars=P_base["exit"], through_ticks=through,
                   capacity_frac=capacity, bar_ms=P_base["bar_ms"])
        trips, orders = run_book(bars, fair, usdq, P, b)
        trips_all += trips; orders_all += orders
        fairs[b] = (fair, usdq, P)
    return trips_all, orders_all, fairs


def breakdown(trips, t0, t1, capital, days):
    res = {}
    for b in BOOKS:
        res[b] = summarize([x for x in trips if x["book"] == b], t0, t1, capital / 4, days=days)
    for k in RUNGS:
        res[f"k={k*100:g}%"] = summarize([x for x in trips if x["k"] == k], t0, t1, capital / 4, days=days)
    for side in ("bid", "ask"):
        res[side] = summarize([x for x in trips if x["side"] == side], t0, t1, capital / 2, days=days)
    return res


def main():
    out_fn = sys.argv[1]
    bars = {b: load_hourly(b) for b in BOOKS}
    bu, bg = load_hourly("BTC-USD"), load_hourly("BTC-GBP")
    fx_btc = build_fx_btc(bu, bg, H)
    fx_y = build_fx_yahoo()
    first_traded = min(next(r[0] for r in bars[b] if r[5] > 0) for b in BOOKS)
    is_days = (OOS0 - first_traded) / 86400000
    oos_days = (OOS1 - OOS0) / 86400000
    base = {"active": 0, "exit": 1, "bar_ms": H}
    R = {"prereg": "prereg_revx_stable_quotes.md", "windows": {"IS": [first_traded, OOS0], "OOS": [OOS0, OOS1]},
         "is_days": round(is_days, 2), "oos_days": round(oos_days, 2), "capital_usd": CAPITAL}
    arms = {
        "primary": dict(),
        "stress": dict(through=1, taker_mult=2.0, spread_mult=2.0),
        "capacity_10pct": dict(capacity=0.10),
    }
    trips_primary = None
    for name, kw in arms.items():
        trips, orders, fairs = run(bars, fx_btc, base, H, 6, **kw)
        R[name] = {"IS": summarize(trips, IS0, OOS0, CAPITAL, days=is_days),
                   "OOS": summarize(trips, OOS0, OOS1, CAPITAL, days=oos_days),
                   "orders_per_day_all": round(orders / ((bars["USDC-USD"][-1][0] - first_traded) / 86400000), 1)}
        if name == "primary":
            trips_primary, fairs_primary = trips, fairs
            R[name]["OOS_breakdown"] = breakdown(trips, OOS0, OOS1, CAPITAL, oos_days)
            R[name]["IS_breakdown"] = breakdown(trips, IS0, OOS0, CAPITAL, is_days)
    # robustness: Yahoo X
    trips_y, orders_y, _ = run(bars, fx_y, base, H, 6)
    R["robust_yahoo_fx"] = {"IS": summarize(trips_y, IS0, OOS0, CAPITAL, days=is_days), "OOS": summarize(trips_y, OOS0, OOS1, CAPITAL, days=oos_days)}
    # null: random-time twins of the primary OOS trips
    rng = random.Random(20260923)
    oos_trips = sorted([x for x in trips_primary if OOS0 <= x["t_entry"] < OOS1], key=lambda z: (z["book"], z["t_entry"], z["side"], z["k"]))
    pools = {}
    for b in BOOKS:
        pools[b] = [i for i, r in enumerate(bars[b]) if OOS0 <= r[0] < OOS1 and r[5] > 0]
    cache = {}
    draws = []
    for d in range(2000):
        tot = 0.0
        for x in oos_trips:
            b = x["book"]
            i = pools[b][rng.randrange(len(pools[b]))]
            key = (b, i, x["side"])
            if key not in cache:
                fair, usdq, P = fairs_primary[b]
                cache[key] = exit_path(bars[b], i, x["side"], bars[b][i][4], fair, P, usdq, 100.0)
            v = cache[key]
            tot += v if v is not None else 0.0
        draws.append(tot)
    draws.sort()
    p95 = draws[int(0.95 * (len(draws) - 1))]
    prim = R["primary"]["OOS"]["pnl_usd"]
    R["null_random_time"] = {"draws": len(draws), "mean": round(st.mean(draws), 4), "p05": round(draws[int(0.05 * 1999)], 4),
                             "p50": round(draws[1000], 4), "p95": round(p95, 4),
                             "share_draws_ge_primary": round(sum(1 for x in draws if x >= prim) / len(draws), 4)}
    R["bar"] = {
        "1_primary_oos_gt_0": prim > 0,
        "2_primary_oos_gt_null_p95": prim > p95,
        "3_stress_oos_gt_0": R["stress"]["OOS"]["pnl_usd"] > 0,
        "4_capacity_oos_gt_0": R["capacity_10pct"]["OOS"]["pnl_usd"] > 0,
    }
    R["bar"]["PASS"] = all(R["bar"].values())
    # descriptive: 1-minute replay of the last 28 days
    try:
        m = {}
        for b in BOOKS + ["BTC-USD", "BTC-GBP"]:
            rows = jload(f"{S}/revx_hist/{b}_1m.json")
            m[b] = [(r[0], r[1], r[2], r[3], r[4], r[5], r[5] * r[4]) for r in rows]
        # The replay re-evaluates FILLS minute by minute with the primary arm's own hourly fair values
        # (fair is an hourly quantity in the rule). An earlier draft recomputed fairU from 1-minute
        # closes with a 60-traded-minute minimum, which left the thin USDC books without a fair most
        # hours and quoted almost nothing; that was a defect of the descriptive arm, not of the rule.
        t_first = max(r[0] for r in [m[b][0] for b in BOOKS])
        t_last = m["USDC-USD"][-1][0]
        days_m = (t_last - t_first) / 86400000
        variants = {}
        for vname, fxv in (("fair_hourly_primary", None), ("fair_hourly_X_from_last_minute", build_fx_btc(m["BTC-USD"], m["BTC-GBP"], 60000))):
            trips_m, orders_m = [], 0
            for b in BOOKS:
                fair, usdq, Pp = fairs_primary[b]
                if fxv is not None and b.endswith("GBP"):
                    s_ = b.split("-")[0]
                    fu = {h: (f * fx_btc(h) if (f is not None and fx_btc(h)) else None) for h, f in fair.items()}
                    fair = {h: (fu[h] / fxv(h) if (fu.get(h) and fxv(h)) else None) for h in fair}
                Pm = Params(RUNGS, 100.0, TICK, 0.0, 0.0009, SPREAD_BPS[b] / 2 / 1e4, 24 * H,
                            active_delay_bars=1, exit_delay_bars=1, bar_ms=60000)
                tr, od = run_book(m[b], fair, usdq, Pm, b)
                trips_m += tr; orders_m += od
            variants[vname] = {"summary": summarize(trips_m, t_first, t_last + 1, CAPITAL, days=days_m),
                               "per_book": {b: summarize([x for x in trips_m if x["book"] == b], t_first, t_last + 1, CAPITAL / 4, days=days_m) for b in BOOKS},
                               "per_rung": {f"k={k*100:g}%": summarize([x for x in trips_m if x["k"] == k], t_first, t_last + 1, CAPITAL / 4, days=days_m) for k in RUNGS},
                               "orders_per_day": round(orders_m / days_m, 1)}
        R["replay_1m_last28d"] = {"from": t_first, "to": t_last, "variants": variants}
        # the same 28 days in the hourly primary, for comparison
        R["replay_1m_last28d"]["hourly_primary_same_span"] = summarize(trips_primary, t_first, t_last + 1, CAPITAL, days=days_m)
    except FileNotFoundError as e:
        R["replay_1m_last28d"] = {"error": str(e)}
    # the OOS trips themselves (for audit)
    R["oos_trips"] = [{k: (round(v, 6) if isinstance(v, float) else v) for k, v in x.items()} for x in oos_trips]
    json.dump(R, open(out_fn, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
