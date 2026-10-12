"""CBK: PR5's frozen rule on Coinbase's four books with ONE thing changed at a time, as candidates for a twin variant row or
a later pre-registration (docs/agents/reviews/2026-10-12-coinbase-first-days.md, section 5). Exploratory and in sample: it
reads only the committed inputs of the venue screen (../../scq_venues/inputs/), writes only ../results/cbk.json, and
imports `sv_sim.py` (and through it PR5's frozen `pr5_sim.simulate`) read-only. It does not touch the running paper test.

The base arm is the venue screen's own (through-fills, £100 a rung, 0 % maker, Coinbase's stop cost, the window's X and fair
exactly as `sv_sim.py` builds them): it must reproduce `../../cbpaper/results/compare.json`'s Coinbase figures, which the
run prints (`check`). The arms, each a change to that base:

* base    RUNGS 0.10 / 0.20 / 0.30 %
* k_5     RUNGS 0.05 / 0.10 / 0.15 %
* k_3     RUNGS 0.03 / 0.06 / 0.10 %
* k_7     RUNGS 0.07 / 0.14 / 0.21 %
* k_wide  RUNGS 0.15 / 0.30 / 0.45 % (every offset half as far again)
* skew    the base rungs round a fair moved by the book's own median basis (print price over fair, over the whole record)
* wkend   the base rungs, with an X that holds its last interbank value through a closure up to 60 hours (a Friday close to a
          Sunday open) instead of going dark after ten minutes: the Coinbase counterpart of PR5-W's weekend question, on
          Coinbase's own history, not PR5-W's data or its pre-registration
usage: python3 -I cbk.py  (about three minutes on four cores)  -> ../results/cbk.json
"""
import bisect, json, multiprocessing as mp, os, statistics as st, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VENUES = os.path.normpath(os.path.join(ROOT, "..", "scq_venues", "scripts"))
sys.path.insert(0, VENUES)
import sv_sim as S  # noqa: E402  (read-only; imports PR5's frozen simulator and CJ5's adaptor through it)

SI, CI, BR, P, M = S.SI, S.CI, S.BR, S.P, S.M
KEYS = ["coinbase:USDC-GBP", "coinbase:USDT-GBP", "coinbase:USDC-EUR", "coinbase:USDT-EUR"]
DAY = S.DAY
WINDOWS = {"last_12_months": S.WINDOWS["last_12_months"], "last_90_days": S.CI.ms("2026-07-11T00:00"),
           "since_2026-08-24": S.WINDOWS["since_2026-08-24"], "last_28_days": S.WINDOWS["last_28_days"]}
GRIDS = {"base": [0.001, 0.002, 0.003], "k_5": [0.0005, 0.001, 0.0015], "k_3": [0.0003, 0.0006, 0.001],
         "k_7": [0.0007, 0.0014, 0.0021], "k_wide": [0.0015, 0.003, 0.0045]}
HOLD_MAX_MS = 60 * 3600 * 1000


def hold(ts, vs, limit=HOLD_MAX_MS):
    """The series with every closure of 10 minutes to `limit` filled, a value a minute, with the last value before it."""
    t2, v2 = list(ts), list(vs)
    out_t, out_v = [], []
    for i in range(len(t2)):
        out_t.append(t2[i]); out_v.append(v2[i])
        if i + 1 < len(t2):
            gap = t2[i + 1] - t2[i]
            if 10 * M < gap <= limit:
                for t in range(t2[i] + M, t2[i + 1], M):
                    out_t.append(t); out_v.append(v2[i])
    return out_t, out_v


def build(key, weekend):
    """sv_sim.build_book, with the interbank series optionally held through closures."""
    venue, name, quote, coin, tick = SI.BOOKS[key]
    bars, meta = SI.load_bars(key)
    gb_t, gb_v = CI.load_fx()
    first = min(bars) * M // DAY * DAY
    t0 = max(S.W0, first)
    hrs = CI.load_usd()[coin]
    ht, hc = [h[0] for h in hrs], [h[1] for h in hrs]
    eu_t, eu_v = SI.load_eurusd()
    if weekend:
        gb_t, gb_v = hold(gb_t, gb_v)
        eu_t, eu_v = hold(eu_t, eu_v)
    ax_t, ax_v = (gb_t, gb_v) if quote == "GBP" else (eu_t, eu_v)
    B = BR.BarBook(key, {str(k): v for k, v in bars.items()}, t0, S.END, ax_t, ax_v, ht, hc, tick, gbp=True)
    for i in range(B.n):
        if quote == "GBP":
            continue
        g = S.series_at(gb_t, gb_v, t0 + i * M)
        B.X[i] = (B.Xreal[i] / g) if (B.X[i] and g) else None
    B.meta = {"venue": venue, "quote": quote, "coin": coin, "tick": tick, "t0": t0}
    return B


def basis(B):
    """The median of (last print price / fair - 1) over the book's minutes with prints and a fair: the book's standing offset."""
    xs = []
    for i, ps in B.by_min.items():
        f = B.F[i]
        if f and ps:
            xs.append(ps[-1][1] * B.tick / f - 1)
    return st.median(xs) if xs else 0.0


def simulate(key, B, rungs, touch):
    saved = (P.TICK, P.FEE, P.HALF_SPREAD, P.RUNGS)
    try:
        P.TICK, P.HALF_SPREAD, P.FEE, P.RUNGS = B.meta["tick"], touch, S.taker_of(key), rungs
        trips, orders = P.simulate(B, size=100.0)
    finally:
        P.TICK, P.FEE, P.HALF_SPREAD, P.RUNGS = saved
    return [{"book": key, "t_entry": x["t_entry"], "t_exit": x["t_exit"], "pnl": x["pnl_usd"], "notional": x["notional_usd"], "how": x["how"],
             "k": x["k"], "side": x["side"]} for x in trips]


def task(key):
    touch = json.load(open(os.path.join(S.ROOT, "inputs", "touch.json")))[key]["half_spread"]
    out = {}
    B = build(key, weekend=False)
    S.META[key] = B.meta
    b = basis(B)
    for arm, rungs in GRIDS.items():
        out[arm] = simulate(key, B, rungs, touch)
    f0 = list(B.F)
    B.F = [f * (1 + b) if f else None for f in f0]
    out["skew"] = simulate(key, B, GRIDS["base"], touch)
    B.F = f0
    del B
    Bw = build(key, weekend=True)
    out["wkend"] = simulate(key, Bw, GRIDS["base"], touch)
    return key, {"basis_bps": round(b * 1e4, 3), "t0": S.META[key]["t0"]}, out


def in_closure(ms):
    """An entry minute inside an FX closure: Friday 22:00 UTC to Sunday 23:00 UTC (the screen's own X is dark there)."""
    import datetime
    d = datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc)
    return (d.weekday() == 4 and d.hour >= 22) or d.weekday() == 5 or (d.weekday() == 6 and d.hour < 23)


def closure_report(tr):
    """The wkend arm's trips ENTERED inside a closure: how many, what they made, and how it spreads over the weekends."""
    import collections, datetime
    sel = [x for x in tr if in_closure(x["t_entry"]) and x["t_entry"] >= WINDOWS["last_12_months"]]
    weekends = collections.defaultdict(float)
    for x in sel:
        d = datetime.datetime.fromtimestamp(x["t_entry"] / 1000, datetime.timezone.utc)
        sunday = (d + datetime.timedelta(days=(6 - d.weekday()))).strftime("%Y-%m-%d")
        weekends[sunday] += x["pnl"]
    stops = [x for x in sel if x["how"] == "taker"]
    v = sorted(weekends.values())
    return {"window": "last_12_months", "trips_entered_in_closure": len(sel), "pnl_gbp": round(sum(x["pnl"] for x in sel), 4),
            "stops": len(stops), "stop_pnl_gbp": round(sum(x["pnl"] for x in stops), 4), "worst_trip_gbp": round(min((x["pnl"] for x in sel), default=0), 4),
            "weekends_with_trips": len(v), "weekends_positive": sum(1 for a in v if a > 0), "weekends_negative": sum(1 for a in v if a < 0),
            "worst_weekend_gbp": round(v[0], 4) if v else None, "best_weekend_gbp": round(v[-1], 4) if v else None,
            "median_weekend_gbp": round(st.median(v), 4) if v else None}


def main():
    with mp.Pool(4) as pool:
        res = pool.map(task, KEYS)
    meta = {k: m for k, m, _ in res}
    S.META.update({k: {"t0": m["t0"]} for k, m in meta.items()})
    trips = {arm: [x for _, _, o in res for x in o[arm]] for arm in list(GRIDS) + ["skew", "wkend"]}
    table = {}
    for arm, tr in trips.items():
        table[arm] = {}
        for w, t0 in WINDOWS.items():
            row = {"all": S.stats(tr, KEYS, 100.0, t0)}
            for k in KEYS:
                row[k] = S.stats([x for x in tr if x["book"] == k], [k], 100.0, t0)
            row = {n: {m: v[m] for m in ("trips", "pnl_gbp", "gbp_per_year", "pct_per_year_on_capital", "win_rate", "stops", "stop_pnl_gbp", "max_drawdown_gbp", "best_day_share")} for n, v in row.items()}
            row["bootstrap_all"] = S.bootstrap(tr, t0)
            table[arm][w] = row
    closure = closure_report(trips["wkend"])
    check = json.load(open(os.path.join(ROOT, "..", "cbpaper", "results", "compare.json")))["venues"]["coinbase"]
    base_check = {w: {"here": table["base"][w]["all"]["gbp_per_year"], "compare_json": check[w]["100"]["gbp_per_year"]} for w in WINDOWS}
    os.makedirs(os.path.join(ROOT, "results"), exist_ok=True)
    json.dump({"basis_bps": {k: m["basis_bps"] for k, m in meta.items()}, "grids": GRIDS, "check_base_against_compare_json": base_check,
               "windows": {w: S.day_of(t) for w, t in WINDOWS.items()}, "weekend_closure_trips_of_the_wkend_arm": closure, "arms": table}, open(os.path.join(ROOT, "results", "cbk.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps({"basis_bps": {k: m["basis_bps"] for k, m in meta.items()}, "check": base_check}, indent=1))
    for w in WINDOWS:
        print(w)
        for arm in table:
            a = table[arm][w]["all"]
            print("  %-7s trips %5d  £/yr %9.2f  %%/yr %7.2f  stops %3d  win %.3f" % (arm, a["trips"], a["gbp_per_year"] or 0, a["pct_per_year_on_capital"] or 0, a["stops"], a["win_rate"] or 0))


if __name__ == "__main__":
    main()
