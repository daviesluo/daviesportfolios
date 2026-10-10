"""PR5's frozen rule on every stablecoin-against-fiat book that clears the fee screen (maker <= 0.02 %) and serves its
history keylessly: Coinbase (USDC-GBP, USDT-GBP, USDC-EUR, USDT-EUR), OKX (USDC-EUR, USDT-EUR, USDG-EUR), Kraken
(USDe/EUR on its 0 % campaign rate; USDG/USD), and Bitstamp (USDC/EUR, USDT/EUR, RLUSD/EUR; candle-grade, fee assumed).

The rule is `docs/agents/scripts/pr5/pr5_sim.py`'s `simulate`, imported read-only through CJ5's `VBook`, on minute bars
(bars.py, proven equal to the prints in calibrate_bars.py). Fixed before any P&L was read:
* Window 2024-10-01 00:00 (or the book's first print day) -> 2026-10-09 00:00 UTC; each book starts flat.
* Anchor: GBP/USD = CJ5's EXN/Yahoo series; EUR/USD = EXN to 2026-09-30, then Yahoo (sv_inputs.py). X(t) = the latest
  minute in [t-10, t-1], else dark (no entry quotes). A USD book has no anchor and quotes every minute.
* fairU: PR5's F3 shape (median of a USD book's hourly closes over [t-24 h, t-1 h]): USDC Bitstamp USDC/USD, USDT
  Coinbase USDT-USD (CJ5's series), USDG Kraken USDG/USD, USDe Kraken USDE/USD, RLUSD Bitstamp RLUSD/USD. fair = fairU/X.
* Sizing in pounds: the book's X is the pound value of one unit of its quote currency (1 for GBP books; EUR/USD÷GBP/USD
  for EUR books; 1/(GBP/USD) for the USD book), so `size`, the 10 % cap and every P&L are pounds.
* Fees: maker 0 % (the simulator's own); the stop pays the venue's taker fee plus half the book's touch read 2026-10-09
  (inputs/touch.json). P.TICK = the book's price increment.
* Arms: fills strictly THROUGH the quote (primary) at £10 / £50 / £100 a rung; AT the price (optimistic bound) at £100;
  one tick deeper with a double stop cost (stress) at £100; capacity at £300 and £1,000 a rung.
* Kraken USDe/EUR also at Kraken's standard stablecoin fee (0.20 % maker, 0.20 % taker): each maker leg pays 0.20 % of
  the trip's notional, the stop 0.20 % + half the touch.
usage: python3 -I sv_sim.py   -> ../results/sv.json, ../results/daily_100.json
"""
import bisect, collections, datetime, gzip, json, multiprocessing as mp, os, random, statistics as st, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CJ5 = os.path.normpath(os.path.join(ROOT, "..", "cj5", "scripts"))
sys.path.insert(0, HERE)
sys.path.insert(0, CJ5)
import bars as BR  # noqa: E402
import sv_inputs as SI  # noqa: E402
import inputs as CI  # noqa: E402  (CJ5's)
P = BR.P
M, DAY = 60000, 86400000
W0 = CI.ms("2024-10-01T00:00")
END = CI.ms("2026-10-09T00:00")
WINDOWS = {"all_from_2024-10-01": W0, "y2024_q4": (W0, CI.ms("2025-01-01T00:00")), "y2025": (CI.ms("2025-01-01T00:00"), CI.ms("2026-01-01T00:00")),
           "y2026_to_10-09": CI.ms("2026-01-01T00:00"), "last_12_months": CI.ms("2025-10-09T00:00"), "since_2025-11-26_PR5_overlap": CI.ms("2025-11-26T00:00"),
           "since_2026-08-24": CI.ms("2026-08-24T00:00"), "last_28_days": CI.ms("2026-09-11T00:00")}
TAKER = {"coinbase": 0.000045, "okx": 0.0005, "kraken:USDEEUR": 0.0, "kraken:USDGUSD": 0.0001, "bitstamp": 0.0001}
FEE_SOURCE = {
    "coinbase": "0.00 % maker / 0.0045 % taker on fx_stablecoin pairs (Coinbase Exchange fees page via search; help.coinbase.com: stable pairs maker 0.00 %); coinbase.com refused this machine (403)",
    "okx": "OKX EEA spot-only accounts from 2026-09-25: stablecoins 0.000 % maker / 0.050 % taker at Regular tier (okx.com/en-eu/help/important-notice-upcoming-spot-fee-adjustment-eea, published 2026-09-11)",
    "kraken:USDEEUR": "Kraken fee schedule: USDe pairs 0.0 % / 0.0 % '0 fee campaign until the 30th June, 2026' (still on the page 2026-10-09; the date has passed: unverified for today); standard stablecoin tier 0.20 % / 0.20 %",
    "kraken:USDGUSD": "Kraken fee schedule: USDG pairs 0.0 % maker / 0.01 % taker at $0+",
    "bitstamp": "not verified at source (the fee page renders nothing here); a third-party comparison quotes 0.00 % maker / 0.01 % taker on stable pairs, another 0.06 % / 0.08 %; scored at 0 % / 0.01 % as a best case",
}
SIZES = (10.0, 50.0, 100.0)
ARMS = [(s, "through") for s in SIZES] + [(100.0, "at_price"), (100.0, "stress"), (300.0, "through"), (1000.0, "through")]
BUILT, META = {}, {}


def taker_of(key):
    return TAKER.get(key, TAKER.get(key.split(":")[0]))


def day_of(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")


def series_at(ts, vs, t):
    k = bisect.bisect_right(ts, t - M) - 1
    return vs[k] if k >= 0 and ts[k] >= t - 10 * M else None


def build_book(key):
    venue, name, quote, coin, tick = SI.BOOKS[key]
    bars, meta = SI.load_bars(key)
    gb_t, gb_v = CI.load_fx()
    first = min(bars) * M // DAY * DAY
    t0 = max(W0, first)
    if coin in ("USDC", "USDT"):
        hrs = CI.load_usd()[coin]
    else:
        hrs = SI.load_usd_extra()[coin]
    ht, hc = [h[0] for h in hrs], [h[1] for h in hrs]
    if quote == "GBP":
        ax_t, ax_v = gb_t, gb_v
    elif quote == "EUR":
        ax_t, ax_v = SI.load_eurusd()
    else:
        ax_t = list(range(t0 - 20 * M, END, M)); ax_v = [1.0] * len(ax_t)
    B = BR.BarBook(key, {str(k): v for k, v in bars.items()}, t0, END, ax_t, ax_v, ht, hc, tick, gbp=True)
    for i in range(B.n):
        t = t0 + i * M
        if quote == "GBP":
            continue
        g = series_at(gb_t, gb_v, t)
        if quote == "EUR":
            B.X[i] = (B.Xreal[i] / g) if (B.X[i] and g) else None
        else:
            B.X[i] = (1.0 / g) if g else None
    B.meta = {"venue": venue, "quote": quote, "coin": coin, "tick": tick, "t0": t0, "first_print_day": day_of(first),
              "minutes_with_prints": len(B.by_min), "prints": meta["prints"],
              "candle_grade": venue == "bitstamp"}
    return B


def run(key, size, arm):
    B = BUILT[key]
    touch = json.load(open(os.path.join(ROOT, "inputs", "touch.json")))[key]["half_spread"]
    saved = (P.TICK, P.FEE, P.HALF_SPREAD, P.through)
    try:
        P.TICK = B.meta["tick"]
        P.HALF_SPREAD = touch
        P.FEE = 0.002 if arm == "kraken_std_fee" else taker_of(key)
        if arm == "at_price":
            P.through = lambda side, price, q, thr: (q <= price) if side == "bid" else (q >= price)
        trips, orders = P.simulate(B, size=size, stress=(arm == "stress"))
    finally:
        P.TICK, P.FEE, P.HALF_SPREAD, P.through = saved
    if arm == "kraken_std_fee":
        for x in trips:
            x["pnl_usd"] -= 0.002 * x["notional_usd"] * (2 if x["how"] == "maker" else 1)
    slim = [{"book": key, "t_entry": x["t_entry"], "t_exit": x["t_exit"], "pnl": x["pnl_usd"], "notional": x["notional_usd"],
             "how": x["how"], "k": x["k"], "side": x["side"]} for x in trips]
    return key, size, arm, slim, sum(orders.values())


def book_days(key, t0, t1):
    a = max(t0, META[key]["t0"])
    return max(0, (t1 - a) / DAY)


def stats(trips, keys, size, t0, t1=END):
    sel = [x for x in trips if t0 <= x["t_entry"] < t1]
    days = (t1 - max(t0, min(META[k]["t0"] for k in keys))) / DAY
    cap_years = sum(6 * size * book_days(k, t0, t1) / 365 for k in keys)
    tot = sum(x["pnl"] for x in sel)
    cum = peak = mdd = 0.0
    for x in sorted(sel, key=lambda z: (z["t_exit"], z["t_entry"], z["book"], z["side"], z["k"])):
        cum += x["pnl"]; peak = max(peak, cum); mdd = max(mdd, peak - cum)
    byday = collections.Counter()
    for x in sel:
        byday[day_of(x["t_entry"])] += x["pnl"]
    hold = sorted((x["t_exit"] - x["t_entry"]) / M for x in sel)
    q = lambda a, p: a[min(len(a) - 1, int(p * (len(a) - 1)))] if a else None
    stops = [x for x in sel if x["how"] == "taker"]
    r4 = lambda v: None if v is None else round(v, 4)
    return {"trips": len(sel), "pnl_gbp": r4(tot), "days": round(days, 2), "gbp_per_year": r4(tot / days * 365) if days else None,
            "pct_per_year_on_capital": r4(100 * tot / cap_years) if cap_years else None,
            "win_rate": r4(sum(1 for x in sel if x["pnl"] > 0) / len(sel)) if sel else None,
            "stops": len(stops), "stop_pnl_gbp": r4(sum(x["pnl"] for x in stops)), "stop_share": r4(len(stops) / len(sel)) if sel else None,
            "median_hold_min": q(hold, 0.5), "p90_hold_min": q(hold, 0.9), "max_drawdown_gbp": r4(mdd),
            "worst_day_gbp": r4(min(byday.values(), default=0.0)), "best_day_share": r4(max(byday.values()) / tot) if tot > 0 and byday else None,
            "days_positive": sum(1 for v in byday.values() if v > 0), "days_negative": sum(1 for v in byday.values() if v < 0),
            "fill_gbp_per_day": round(sum(x["notional"] for x in sel) / days, 2) if days else None}


def bootstrap(trips, t0, t1=END):
    D = [day_of(t) for t in range(t0 // DAY * DAY, t1, DAY)]
    byday = collections.Counter()
    for x in trips:
        if t0 <= x["t_entry"] < t1:
            byday[day_of(x["t_entry"])] += x["pnl"]
    v = [byday.get(d, 0.0) for d in D]
    rng = random.Random(20261023)
    s = sorted(sum(rng.choice(v) for _ in range(len(v))) for _ in range(2000))
    return {"days": len(v), "sum_gbp": round(sum(v), 4), "index100_gbp_per_year": round(s[100] / len(v) * 365, 4),
            "share_draws_gt_0": round(sum(1 for x in s if x > 0) / 2000, 4)}


def by_month(trips):
    m = collections.Counter()
    for x in trips:
        m[day_of(x["t_entry"])[:7]] += x["pnl"]
    return {k: round(v, 4) for k, v in sorted(m.items())}


def volume_gbp_per_day(B, t0, t1=END):
    lastX, tot = None, 0.0
    for i in range(B.n):
        if B.X[i]:
            lastX = B.X[i]
        t = B.t0 + i * M
        if t0 <= t < t1 and i in B.qvol and lastX:
            tot += B.qvol[i] * lastX
    d = (t1 - max(t0, B.meta["t0"])) / DAY
    return round(tot / d, 2) if d > 0 else None


def window_stats(trips, keys, size):
    out = {}
    for name, w in WINDOWS.items():
        a, z = (w if isinstance(w, tuple) else (w, END))
        out[name] = stats(trips, keys, size, a, z)
    return out


def _task(key):
    """One book: build it, run every arm on it (one process holds one book at a time)."""
    BUILT.clear()
    BUILT[key] = B = build_book(key)
    print("built", key, B.meta, flush=True)
    arms = list(ARMS) + ([(100.0, "kraken_std_fee")] if key == "kraken:USDEEUR" else [])
    out = {f"{a}_{int(s)}": run(key, s, a)[3:] for s, a in arms}
    vol = {"all": volume_gbp_per_day(B, W0), "last_12_months": volume_gbp_per_day(B, WINDOWS["last_12_months"]),
           "last_28_days": volume_gbp_per_day(B, WINDOWS["last_28_days"])}
    BUILT.clear()
    return key, B.meta, vol, out


def main():
    with mp.get_context("fork").Pool(4) as pool:
        res = pool.map(_task, list(SI.BOOKS), chunksize=1)
    R = {"fees": FEE_SOURCE, "touch": json.load(open(os.path.join(ROOT, "inputs", "touch.json"))), "books": {}}
    T = {}
    for key, meta, vol, out in res:
        META[key] = meta
        T[key] = out
        R["books"][key] = {"meta": meta, "volume_gbp_per_day": vol, "arms": {}}
    for key in SI.BOOKS:
        A = R["books"][key]
        for an, (tr, od) in T[key].items():
            s = float(an.rsplit("_", 1)[1])
            E = {"windows": window_stats(tr, [key], s), "orders_per_day": round(od / book_days(key, W0, END), 1)}
            if an == "through_100":
                E["by_month"] = by_month(tr)
                E["bootstrap_last_12_months"] = bootstrap(tr, WINDOWS["last_12_months"])
                E["bootstrap_all"] = bootstrap(tr, max(W0, META[key]["t0"]))
                E["by_rung"] = {f"k={kk * 100:g}%": round(sum(x["pnl"] for x in tr if x["k"] == kk), 4) for kk in P.RUNGS}
                E["by_side"] = {sd: round(sum(x["pnl"] for x in tr if x["side"] == sd), 4) for sd in ("bid", "ask")}
            A["arms"][an] = E
        w = A["arms"]["through_100"]["windows"]
        print(f"{key:20s} all £{w['all_from_2024-10-01']['pnl_gbp']:9.2f} 12m £{w['last_12_months']['pnl_gbp']:8.2f} "
              f"({w['last_12_months']['pct_per_year_on_capital']}%/yr) 28d £/yr {w['last_28_days']['gbp_per_year']} "
              f"trips {w['last_12_months']['trips']} stops {w['last_12_months']['stops']}", flush=True)
    daily = {}
    for key in SI.BOOKS:
        d = collections.Counter()
        for x in T[key]["through_100"][0]:
            d[day_of(x["t_entry"])] += x["pnl"]
        daily[key] = {k: round(v, 6) for k, v in sorted(d.items())}
    json.dump(R, open(os.path.join(ROOT, "results", "sv.json"), "w"), indent=1, sort_keys=True)
    json.dump({"meta": {k: META[k]["t0"] for k in SI.BOOKS}, "daily": daily}, open(os.path.join(ROOT, "results", "daily_100.json"), "w"), indent=0, sort_keys=True)
    with gzip.GzipFile(os.path.join(ROOT, "results", "trips_100.json.gz"), "wb", mtime=0) as f:
        f.write(json.dumps({k: sorted([x["t_entry"], x["t_exit"], round(x["pnl"], 8), round(x["notional"], 6), x["how"], x["k"], x["side"]]
                                      for x in T[k]["through_100"][0]) for k in SI.BOOKS}).encode())


if __name__ == "__main__":
    main()
