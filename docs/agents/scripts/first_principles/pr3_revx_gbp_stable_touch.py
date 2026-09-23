"""PR3 — quoting Revolut X's USDC/GBP and USDT/GBP books around interbank with trade-verified fills, as
pre-registered in prereg_revx_gbp_stable_touch.md (frozen 2026-09-23T11:37:49Z, sha256 0f0f1ef1…).

Conventions (from the pre-registration): the loop acts at the start of minute t using data up to t-1;
an order placed or re-priced at t is live from t+1. A fill in minute m is seen at the turn of m+1, so
its exit order is placed at m+1 and live from m+2. Fills are close-based: a traded minute (volume > 0)
whose close (last print) is strictly beyond the order's price.

usage: pr3_revx_gbp_stable_touch.py <out.json>
"""
import gzip, json, sys, os, bisect, random, statistics as st, datetime, math
# Inputs: the committed copy beside the studies (docs/agents/backtests/inputs/first_principles_2026-09-23), read as .json.gz;
# FP_DATA names another folder of the same layout for a test whose inputs are not committed (PR1's hourly year, PR2's Binance year).
S = os.environ.get("FP_DATA") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../backtests/inputs/first_principles_2026-09-23")


def jload(path):
    """A JSON input, as fetched (.json) or as committed (.json.gz)."""
    if os.path.exists(path):
        return json.load(open(path))
    with gzip.open(path + ".gz", "rt") as f:
        return json.load(f)
M = 60000
def ms(s): return int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
IS0, OOS0, OOS1 = ms("2026-08-26T00:00"), ms("2026-09-09T18:00"), ms("2026-09-23T00:00")
BOOKS = ["USDC-GBP", "USDT-GBP"]
RUNGS = [0.001, 0.002, 0.003]
TICK = 0.0001
HALF_SPREAD = 0.000067
CAPITAL = 2 * 2 * 3 * 100.0


def load(sym):
    return jload(f"{S}/revx_hist/{sym}_1m.json")


def rtick(p, up):
    n = p / TICK
    n = math.ceil(n - 1e-9) if up else math.floor(n + 1e-9)
    return round(n * TICK, 10)


def yahoo_fx():
    Y = sorted((r[0], r[4]) for r in jload(f"{S}/ref/yahoo_GBPUSD_1m.json"))
    YT = [t for t, _ in Y]
    def X(t):
        i = bisect.bisect_right(YT, t - M) - 1          # bar start <= t-1min
        if i < 0 or YT[i] < t - 10 * M:
            return None
        return Y[i][1]
    return X


def btc_fx():
    U = {r[0]: r[4] for r in load("BTC-USD")}
    G = {r[0]: r[4] for r in load("BTC-GBP")}
    def X(t):
        a, b = U.get(t - M), G.get(t - M)
        return a / b if a and b else None
    return X


def fair_usd(sym):
    rows = load(sym)
    out = {}
    win = []
    q = []
    for r in rows:
        out[r[0]] = st.median(win) if len(win) >= 60 else None   # closes of [t-1440, t-1]
        bisect.insort(win, r[4]); q.append(r[4])
        if len(q) > 1440:
            old = q.pop(0)
            win.pop(bisect.bisect_left(win, old))
    return out


def simulate(book, bars, fairU, X, stress=False, full=False, collect=None):
    thr = TICK if stress else 0.0
    taker = (0.0018 + 2 * HALF_SPREAD) if stress else (0.0009 + HALF_SPREAD)
    rungs = [{"side": s, "k": k, "mode": "idle", "price": None, "fair_at": None, "live": None}
             for s in ("bid", "ask") for k in RUNGS]
    trips, orders = [], 0
    lastX = None
    n = len(bars)
    for i in range(n):
        t, o, h, l, c, v = bars[i]
        x = X(t)
        if x: lastX = x
        f = (fairU.get(t) / x) if (x and fairU.get(t)) else None
        # 1. the turn at the start of minute t
        for r in rungs:
            if r["mode"] in ("idle", "quote"):
                if f is None:
                    if r["mode"] == "quote":
                        r.update(mode="idle", price=None, fair_at=None)
                    continue
                if r["mode"] == "idle" or abs(f / r["fair_at"] - 1) > 0.0005:
                    p = rtick(f * (1 - r["k"]), False) if r["side"] == "bid" else rtick(f * (1 + r["k"]), True)
                    orders += 1
                    r.update(mode="quote", price=p, fair_at=f, live=i + 1)
            elif r["mode"] == "position":
                if r["xprice"] is None:
                    if f is not None:
                        r["xprice"] = rtick(f, up=(r["side"] == "bid")); r["xfair"] = f; r["xlive"] = i + 1; orders += 1
                elif f is not None and abs(f / r["xfair"] - 1) > 0.0005:
                    r["xprice"] = rtick(f, up=(r["side"] == "bid")); r["xfair"] = f; r["xlive"] = i + 1; orders += 1
        # 2. fills during minute t
        traded = v > 0
        for r in rungs:
            if r["mode"] == "quote" and traded and i >= r["live"]:
                p = r["price"]
                hit = (c < p - thr) if r["side"] == "bid" else (c > p + thr)
                if hit and lastX:
                    usd = 100.0 if full else min(100.0, 0.10 * v * c * lastX)
                    if usd <= 0:
                        continue
                    nq = usd / lastX
                    r.update(mode="position", entry=p, i_e=i, t_e=t, qty=nq / p, nq=nq, xprice=None, xfair=None, xlive=None)
                    continue
            if r["mode"] == "position":
                done = None
                if r["xprice"] is not None and traded and i >= r["xlive"]:
                    xp = r["xprice"]
                    if r["side"] == "bid" and c > xp + thr: done = (xp, "maker")
                    if r["side"] == "ask" and c < xp - thr: done = (xp, "maker")
                if done is None and (t >= r["t_e"] + 1440 * M or i == n - 1):
                    done = (c * (1 - taker), "taker") if r["side"] == "bid" else (c * (1 + taker), "taker")
                if done:
                    px, how = done
                    pnl_q = r["qty"] * (px - r["entry"]) if r["side"] == "bid" else r["qty"] * (r["entry"] - px)
                    xr = lastX or 1.0
                    trips.append({"book": book, "side": r["side"], "k": r["k"], "t_entry": r["t_e"], "t_exit": t, "entry": r["entry"],
                                  "exit": round(px, 8), "how": how, "notional_usd": round(r["nq"] * xr, 6), "pnl_usd": pnl_q * xr, "i_entry": r["i_e"]})
                    r.update(mode="idle", price=None, fair_at=None)
    return trips, orders


def exit_only(book, bars, fairU, X, i0, side, usd):
    """Random-time twin: enter at the close of minute i0, then the same exit machinery."""
    t0, c0 = bars[i0][0], bars[i0][4]
    lastX = None
    for j in range(max(0, i0 - 10), i0 + 1):
        xx = X(bars[j][0])
        if xx: lastX = xx
    if not lastX: return None
    nq = usd / lastX; qty = nq / c0
    xprice = xfair = xlive = None
    taker = 0.0009 + HALF_SPREAD
    for i in range(i0 + 1, len(bars)):
        t, o, h, l, c, v = bars[i]
        x = X(t)
        if x: lastX = x
        f = (fairU.get(t) / x) if (x and fairU.get(t)) else None
        if xprice is None:
            if f is not None:
                xprice = rtick(f, up=(side == "bid")); xfair = f; xlive = i + 1
        elif f is not None and abs(f / xfair - 1) > 0.0005:
            xprice = rtick(f, up=(side == "bid")); xfair = f; xlive = i + 1
        done = None
        if xprice is not None and v > 0 and i >= xlive:
            if side == "bid" and c > xprice: done = xprice
            if side == "ask" and c < xprice: done = xprice
        if done is None and (t >= t0 + 1440 * M or i == len(bars) - 1):
            done = c * (1 - taker) if side == "bid" else c * (1 + taker)
        if done is not None:
            pnl_q = qty * (done - c0) if side == "bid" else qty * (c0 - done)
            return pnl_q * lastX
    return None


def summarize(trips, t0, t1, cap, days):
    sel = [x for x in trips if t0 <= x["t_entry"] < t1]
    tot = sum(x["pnl_usd"] for x in sel)
    cum = peak = mdd = 0.0
    for x in sorted(sel, key=lambda z: (z["t_exit"], z["t_entry"], z["book"], z["side"], z["k"])):
        cum += x["pnl_usd"]; peak = max(peak, cum); mdd = max(mdd, peak - cum)
    return {"trips": len(sel), "pnl_usd": round(tot, 4), "return_on_capital_pct": round(100 * tot / cap, 4),
            "win_rate": round(sum(1 for x in sel if x["pnl_usd"] > 0) / len(sel), 4) if sel else None,
            "worst_trip_usd": round(min((x["pnl_usd"] for x in sel), default=0), 4),
            "best_trip_usd": round(max((x["pnl_usd"] for x in sel), default=0), 4),
            "max_drawdown_usd": round(mdd, 4), "taker_exits": sum(1 for x in sel if x["how"] == "taker"),
            "fill_notional_usd": round(sum(x["notional_usd"] for x in sel), 2),
            "fill_notional_usd_per_day": round(sum(x["notional_usd"] for x in sel) / days, 2), "pnl_usd_per_day": round(tot / days, 4)}


def main():
    out_fn = sys.argv[1]
    bars = {b: [tuple(r) for r in load(b)] for b in BOOKS}
    fU = {b: fair_usd(b.replace("GBP", "USD")) for b in BOOKS}
    XY, XB = yahoo_fx(), btc_fx()
    is_days = (OOS0 - IS0) / 86400000; oos_days = (OOS1 - OOS0) / 86400000
    total_days = (bars["USDC-GBP"][-1][0] - bars["USDC-GBP"][0][0]) / 86400000
    R = {"prereg": "prereg_revx_gbp_stable_touch.md", "capital_usd": CAPITAL, "is_days": round(is_days, 3), "oos_days": round(oos_days, 3)}
    arms = {"primary": dict(X=XY), "stress": dict(X=XY, stress=True), "btc_implied_fx": dict(X=XB), "full_100_fills": dict(X=XY, full=True)}
    for name, kw in arms.items():
        trips, orders = [], 0
        for b in BOOKS:
            tr, od = simulate(b, bars[b], fU[b], **kw)
            trips += tr; orders += od
        R[name] = {"IS": summarize(trips, IS0, OOS0, CAPITAL, is_days), "OOS": summarize(trips, OOS0, OOS1, CAPITAL, oos_days),
                   "orders_per_day": round(orders / total_days, 1)}
        if name == "primary":
            prim_trips = trips
            for part, (a, z, d) in {"OOS": (OOS0, OOS1, oos_days), "IS": (IS0, OOS0, is_days)}.items():
                R[name][f"{part}_by_book"] = {b: summarize([x for x in trips if x["book"] == b], a, z, CAPITAL / 2, d) for b in BOOKS}
                R[name][f"{part}_by_rung"] = {f"k={k*100:g}%": summarize([x for x in trips if x["k"] == k], a, z, CAPITAL / 3, d) for k in RUNGS}
                R[name][f"{part}_by_side"] = {s: summarize([x for x in trips if x["side"] == s], a, z, CAPITAL / 2, d) for s in ("bid", "ask")}
    # null
    oos = sorted([x for x in prim_trips if OOS0 <= x["t_entry"] < OOS1], key=lambda z: (z["book"], z["t_entry"], z["side"], z["k"]))
    pools = {b: [i for i, r in enumerate(bars[b]) if OOS0 <= r[0] < OOS1 and r[5] > 0 and XY(r[0])] for b in BOOKS}
    rng = random.Random(20260923)
    cache, draws = {}, []
    for d in range(2000):
        tot = 0.0
        for x in oos:
            b = x["book"]
            if not pools[b]: continue
            i = pools[b][rng.randrange(len(pools[b]))]
            key = (b, i, x["side"])
            if key not in cache:
                r = bars[b][i]
                usd = min(100.0, 0.10 * r[5] * r[4] * (XY(r[0]) or 0))
                cache[key] = exit_only(b, bars[b], fU[b], XY, i, x["side"], usd) if usd > 0 else 0.0
            tot += cache[key] or 0.0
        draws.append(tot)
    draws.sort()
    p95 = draws[int(0.95 * (len(draws) - 1))]
    prim = R["primary"]["OOS"]["pnl_usd"]
    R["null_random_time"] = {"draws": len(draws), "mean": round(st.mean(draws), 4), "p50": round(draws[1000], 4), "p95": round(p95, 4),
                             "share_draws_ge_primary": round(sum(1 for x in draws if x >= prim) / len(draws), 4)}
    R["bar"] = {"1_primary_oos_gt_0": prim > 0, "2_primary_oos_gt_null_p95": prim > p95,
                "3_stress_oos_gt_0": R["stress"]["OOS"]["pnl_usd"] > 0,
                "4_at_least_20_oos_trips_and_orders_le_1000_per_day": R["primary"]["OOS"]["trips"] >= 20 and R["primary"]["orders_per_day"] <= 1000}
    R["bar"]["PASS"] = all(R["bar"].values())
    R["oos_trips"] = [{k: (round(v, 6) if isinstance(v, float) else v) for k, v in x.items()} for x in oos]
    json.dump(R, open(out_fn, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
