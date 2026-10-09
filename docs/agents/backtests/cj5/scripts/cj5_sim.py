"""CJ5: PR5's rule on CoinJar UK's USDC/GBP and USDT/GBP books, over their whole public print history.

The rule is the frozen `docs/agents/scripts/pr5/pr5_sim.py`, imported read-only: `simulate` and `exit_only` run unchanged on
a `VBook` (vbook.py), which `calibrate.py` proves equal to pr5_sim's own book on PR5's inputs. Fixed before any P&L was
read (and written in the review, §2):
* Window: USDCGBP from 2020-04-02 00:00, USDTGBP from 2021-08-27 00:00 (each book's first print day) to 2026-10-09 00:00
  UTC. Each book starts flat.
* Interbank X: EXN minute-close mids (PR5's frozen source) to 2026-09-30, Yahoo's GBPUSD=X 1-minute closes for October
  2026 (the live loop's source; Exness publishes a month after it ends). X(t) is the latest minute in [t-10, t-1], else
  dark: no entry quotes (weekends and the daily rollover).
* fairU: PR5's F3 shape, the median of a deep USD book's hourly closes in [t-24 h, t-1 h]: USDC from Kraken USDC/USD
  (hourly last print, to 2020-10-19 09:00) then Bitstamp USDC/USD; USDT from Coinbase USDT-USD. CoinJar's own USD
  books start in 2023 and are thin.
* CoinJar's fees: 0.00 % maker (every resting leg), 0.001 % taker (the 24-hour stop), plus half the book's touch on the
  stop (inputs/config.json: 13.9 bps USDC/GBP, 17.2 bps USDT/GBP, the recorder's reading of 2026-10-09; PR5 charged its
  own measured 0.0067 %).
* Fills: a print strictly THROUGH the order (primary); AT the order's price (the optimistic bound, `at_price`); one tick
  deeper with a double stop cost (`stress`, PR5's); size min(£size, 10 % of the minute's printed GBP); exits fill whole.
* Rungs at £10, £50 and £100: 12 rungs, so £120 / £600 / £1,200 of capital (six bids in pounds, six asks in coins).
usage: python3 -I cj5_sim.py   -> ../results/cj5.json (and cj5_trips_100.json.gz)
"""
import bisect, collections, datetime, gzip, json, os, random, statistics as st, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vbook import VBook, P  # noqa: E402
import inputs as I  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
M, DAY = 60000, 86400000
END = I.END_MS
START = I.START_MS
SIZES = (10.0, 50.0, 100.0)
CAP_SIZES = (300.0, 1000.0)
H_SPLIT = I.ms("2023-07-06T00:00")      # the calendar midpoint of 2020-04-02 -> 2026-10-09
RECENT = {"since_2025-10-09_last_12_months": I.ms("2025-10-09T00:00"), "since_2025-11-26_PR5_overlap": I.ms("2025-11-26T00:00"),
          "since_2026-08-24_PR5_tightening": I.ms("2026-08-24T00:00"), "since_2026-09-11_last_28_days": I.ms("2026-09-11T00:00")}


def day_of(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")


def r4(x):
    return None if x is None else round(x, 4)


def build_books():
    fx_t, fx_v = I.load_fx()
    usd = I.load_usd()
    books = {}
    for b in I.PRODUCTS:
        hours = usd[I.COIN[b]]
        books[b] = VBook(b, I.load_prints(b), START[b], END, fx_t, fx_v, [h[0] for h in hours], [h[1] for h in hours], gbp=True)
    return books, fx_t, fx_v


def run(books, size, arm):
    """One arm over both books; returns trips (pounds) and orders by day."""
    cfg = I.load_config()
    trips, orders = [], collections.Counter()
    saved = (P.FEE, P.HALF_SPREAD, P.through)
    try:
        P.FEE = cfg["taker_fee"]
        if arm == "at_price":
            P.through = lambda side, price, q, thr: (q <= price) if side == "bid" else (q >= price)
        for b in I.PRODUCTS:
            P.HALF_SPREAD = cfg["half_spread"][b]
            kw = {"stress": arm == "stress", "side_aware": arm == "side_aware", "full": arm == "full_size"}
            tr, od = P.simulate(books[b], size=size, **kw)
            trips += tr; orders.update(od)
    finally:
        P.FEE, P.HALF_SPREAD, P.through = saved
    return trips, orders


def cap_years(size, t0=None, t1=END):
    return sum(6 * size * max(0, t1 - max(START[b], t0 or 0)) / DAY / 365 for b in I.PRODUCTS)


def window_days(t0, t1=END):
    t0 = max(t0, min(START.values()))
    return [day_of(t) for t in range(t0 // DAY * DAY, t1, DAY)]


def stats(trips, size, t0, t1=END, books=None):
    sel = [x for x in trips if t0 <= x["t_entry"] < t1]
    days = (t1 - max(t0, min(START.values()))) / DAY
    cy = cap_years(size, t0, t1)
    tot = sum(x["pnl_usd"] for x in sel)
    cum = peak = mdd = 0.0
    for x in sorted(sel, key=lambda z: (z["t_exit"], z["t_entry"], z["book"], z["side"], z["k"])):
        cum += x["pnl_usd"]; peak = max(peak, cum); mdd = max(mdd, peak - cum)
    byday = collections.Counter()
    for x in sel:
        byday[day_of(x["t_entry"])] += x["pnl_usd"]
    hold = sorted((x["t_exit"] - x["t_entry"]) / M for x in sel)
    q = lambda a, p: a[min(len(a) - 1, int(p * (len(a) - 1)))] if a else None
    stops = [x for x in sel if x["how"] == "taker"]
    out = {"trips": len(sel), "pnl_gbp": r4(tot), "gbp_per_day": r4(tot / days) if days else None,
           "gbp_per_year": r4(tot / days * 365) if days else None,
           "pct_per_year_on_capital": r4(100 * tot / cy) if cy else None,
           "win_rate": r4(sum(1 for x in sel if x["pnl_usd"] > 0) / len(sel)) if sel else None,
           "stops": len(stops), "stop_pnl_gbp": r4(sum(x["pnl_usd"] for x in stops)),
           "median_hold_min": q(hold, 0.5), "p90_hold_min": q(hold, 0.9),
           "max_drawdown_gbp": r4(mdd), "worst_day_gbp": r4(min(byday.values(), default=0.0)),
           "best_day_share": r4(max(byday.values()) / tot) if tot > 0 and byday else None,
           "days": round(days, 2), "days_with_trips": len(byday),
           "days_positive": sum(1 for v in byday.values() if v > 0), "days_negative": sum(1 for v in byday.values() if v < 0),
           "fill_notional_gbp": round(sum(x["notional_usd"] for x in sel), 2),
           "fill_notional_gbp_per_day": round(sum(x["notional_usd"] for x in sel) / days, 2) if days else None}
    return out


def bootstrap(trips, t0, t1=END):
    """Day blocks: a fresh random.Random(20261023), 2,000 draws of len(D) days with replacement, sums sorted, index 100."""
    D = window_days(t0, t1)
    byday = collections.Counter()
    for x in trips:
        if t0 <= x["t_entry"] < t1:
            byday[day_of(x["t_entry"])] += x["pnl_usd"]
    v = [byday.get(d, 0.0) for d in D]
    rng = random.Random(20261023)
    s = sorted(sum(rng.choice(v) for _ in range(len(v))) for _ in range(2000))
    n = len(v)
    return {"days": n, "sum_gbp": r4(sum(v)), "index100_sum_gbp": r4(s[100]), "index100_gbp_per_year": r4(s[100] / n * 365),
            "median_sum_gbp": r4(s[1000]), "share_draws_gt_0": round(sum(1 for x in s if x > 0) / 2000, 4)}


def by_year(trips, size):
    out = {}
    for y in range(2020, 2027):
        a, z = max(I.ms(f"{y}-01-01T00:00"), min(START.values())), min(I.ms(f"{y + 1}-01-01T00:00"), END)
        s = stats(trips, size, a, z)
        s["by_book"] = {b: stats([x for x in trips if x["book"] == b], size, a, z)["pnl_gbp"] for b in I.PRODUCTS}
        out[str(y)] = s
    return out


def by_month_counts(trips):
    m = collections.Counter()
    for x in trips:
        m[day_of(x["t_entry"])[:7]] += x["pnl_usd"]
    months = sorted({day_of(t)[:7] for t in range(min(START.values()), END, DAY)})
    vals = [m.get(k, 0.0) for k in months]
    tot = sum(vals)
    return {"months": len(months), "positive": sum(1 for v in vals if v > 0), "negative": sum(1 for v in vals if v < 0),
            "max_month_share": r4(max(vals) / tot) if tot > 0 else None, "by_month": {k: r4(m.get(k, 0.0)) for k in months}}


def mark_risk(trips, books, size):
    """Per trip, the worst mark of the open position at fair (pounds) while it was held; the open notional over time."""
    worst = []
    ev = []
    for x in trips:
        B = books[x["book"]]
        i0, i1 = (x["t_entry"] - B.t0) // M, (x["t_exit"] - B.t0) // M
        qty = x["notional_usd"] / x["entry"]
        w = 0.0
        for i in range(i0, min(i1, B.n - 1) + 1):
            f = B.F[i]
            if f is None:
                continue
            m = qty * (f - x["entry"]) if x["side"] == "bid" else qty * (x["entry"] - f)
            w = min(w, m)
        worst.append(w)
        ev.append((x["t_entry"], x["notional_usd"])); ev.append((x["t_exit"], -x["notional_usd"]))
    ev.sort()
    cur = peak = area = 0.0
    last = min(START.values())
    for t, d in ev:
        area += cur * (t - last); last = t
        cur += d; peak = max(peak, cur)
    worst.sort()
    span = END - min(START.values())
    q = lambda a, p: a[min(len(a) - 1, int(p * (len(a) - 1)))] if a else None
    return {"open_notional_gbp_time_weighted_mean": r4(area / span), "open_notional_gbp_max": r4(peak),
            "capital_gbp": 12 * size, "worst_mark_per_trip_gbp": {"min": r4(worst[0]) if worst else None, "p01": r4(q(worst, 0.01)),
                                                                     "p05": r4(q(worst, 0.05)), "median": r4(q(worst, 0.5))}}


def inventory_fx(fx_t, fx_v, size):
    """The coins behind the six asks (6 × size pounds of USDC/USDT at the start of each year) marked in pounds by GBP/USD."""
    out = {}
    for y in range(2020, 2027):
        a = max(I.ms(f"{y}-01-01T00:00"), min(START.values())); z = min(I.ms(f"{y + 1}-01-01T00:00"), END) - M
        xa = fx_v[bisect.bisect_right(fx_t, a) - 1] if bisect.bisect_right(fx_t, a) else fx_v[0]
        xz = fx_v[bisect.bisect_right(fx_t, z) - 1]
        out[str(y)] = {"gbpusd_from": round(xa, 5), "gbpusd_to": round(xz, 5), "coin_half_mark_gbp": round(6 * size * (xa / xz - 1), 2)}
    return out


def null_random_time(trips, books, t0=0, t1=END, draws=2000):
    """PR5's own null (pr5_sim.main): random-time twins of every round trip, entered at a random traded minute with an
    X, through the frozen exit machinery (`exit_only`), seed 20260923, 2,000 draws. Pounds, at the trips' own size."""
    cfg = I.load_config()
    P.FEE = cfg["taker_fee"]
    sel = sorted([x for x in trips if t0 <= x["t_entry"] < t1], key=lambda z: (z["book"], z["t_entry"], z["side"], z["k"]))
    pools = {b: [i for i in sorted(B.by_min) if t0 <= B.t0 + i * M < t1 and B.X[i]] for b, B in books.items()}
    rng = random.Random(20260923)
    cache, res = {}, []
    for _ in range(draws):
        tot = 0.0
        for x in sel:
            b = x["book"]
            i = pools[b][rng.randrange(len(pools[b]))]
            key = (b, i, x["side"])
            if key not in cache:
                Bk = books[b]
                P.HALF_SPREAD = cfg["half_spread"][b]
                usd = min(100.0, 0.10 * Bk.qvol[i] * Bk.X[i])
                cache[key] = P.exit_only(Bk, i, x["side"], usd, Bk.X[i]) if usd > 0 else 0.0
            tot += cache[key]
        res.append(tot)
    res.sort()
    prim = sum(x["pnl_usd"] for x in sel)
    return {"draws": draws, "seed": 20260923, "trips": len(sel), "primary_gbp": r4(prim), "mean": r4(st.mean(res)),
            "p95": r4(res[int(0.95 * (draws - 1))]), "max": r4(res[-1]), "share_draws_ge_primary": round(sum(1 for v in res if v >= prim) / draws, 4),
            "distinct_twins": len(cache)}


def main():
    books, fx_t, fx_v = build_books()
    R = {"config": I.load_config(), "window": {b: [day_of(START[b]), day_of(END)] for b in I.PRODUCTS},
         "coverage": {b: {"minutes": B.n, "minutes_with_x": sum(1 for x in B.X if x), "minutes_with_fair": sum(1 for f in B.F if f),
                          "minutes_with_prints": len(B.by_min), "prints": sum(len(v) for v in B.by_min.values()),
                          "gbp_volume": round(sum(B.qvol.values()), 2),
                          "gbp_volume_per_day": round(sum(B.qvol.values()) / ((END - START[b]) / DAY), 2)} for b, B in books.items()},
         "arms": {}}
    keep = None
    for size in SIZES:
        for arm in ("through", "at_price", "stress") + (("side_aware", "full_size") if size == 100.0 else ()):
            trips, orders = run(books, size, arm)
            A = {"all": stats(trips, size, 0), "by_book": {b: stats([x for x in trips if x["book"] == b], size, 0) for b in I.PRODUCTS},
                 "H1_to_2023-07-06": stats(trips, size, 0, H_SPLIT), "H2_from_2023-07-06": stats(trips, size, H_SPLIT),
                 "recent": {k: stats(trips, size, t) for k, t in RECENT.items()},
                 "orders_per_day_mean": round(sum(orders.values()) / ((END - min(START.values())) / DAY), 1),
                 "orders_per_day_max": max(orders.values()) if orders else 0}
            if arm in ("through", "at_price"):
                A["by_year"] = by_year(trips, size)
                A["months"] = by_month_counts(trips)
                A["by_rung"] = {f"k={k * 100:g}%": stats([x for x in trips if x["k"] == k], size, 0)["pnl_gbp"] for k in P.RUNGS}
                A["by_side"] = {s: stats([x for x in trips if x["side"] == s], size, 0)["pnl_gbp"] for s in ("bid", "ask")}
                A["bootstrap"] = {"all": bootstrap(trips, 0), "H1": bootstrap(trips, 0, H_SPLIT), "H2": bootstrap(trips, H_SPLIT),
                                  **{k: bootstrap(trips, t) for k, t in RECENT.items()}}
            if arm == "through":
                A["mark_risk"] = mark_risk(trips, books, size)
                A["inventory_gbpusd_mark"] = inventory_fx(fx_t, fx_v, size)
            R["arms"][f"{arm}_{int(size)}"] = A
            print(f"{arm:10s} £{size:5.0f}: {A['all']['trips']:6d} trips £{A['all']['pnl_gbp']:9.2f} £{A['all']['gbp_per_year']:8.2f}/yr "
                  f"{A['all']['pct_per_year_on_capital']:7.2f}%/yr H1 £{A['H1_to_2023-07-06']['pnl_gbp']:.2f} H2 £{A['H2_from_2023-07-06']['pnl_gbp']:.2f} "
                  f"last12m £{A['recent']['since_2025-10-09_last_12_months']['pnl_gbp']:.2f} stops {A['all']['stops']}", flush=True)
            if arm == "through" and size == 100.0:
                keep = trips
    # capacity: bigger rungs, the same 10 % cap
    R["capacity"] = {}
    for size in CAP_SIZES:
        trips, _ = run(books, size, "through")
        R["capacity"][f"rung_{int(size)}"] = {"all": stats(trips, size, 0), "last_12_months": stats(trips, size, RECENT["since_2025-10-09_last_12_months"])}
    R["null_random_time_100"] = {"all": null_random_time(keep, books),
                                 "last_12_months": null_random_time(keep, books, RECENT["since_2025-10-09_last_12_months"])}
    json.dump(R, open(os.path.join(HERE, "results", "cj5.json"), "w"), indent=1, sort_keys=True)
    with gzip.GzipFile(os.path.join(HERE, "results", "cj5_trips_100.json.gz"), "wb", mtime=0) as f:
        f.write(json.dumps([{k: (round(v, 8) if isinstance(v, float) else v) for k, v in x.items()} for x in
                            sorted(keep, key=lambda z: (z["t_entry"], z["book"], z["side"], z["k"]))]).encode())
    print("null", R["null_random_time_100"])


if __name__ == "__main__":
    main()
