"""OTHERVENUES step 3: PR5's frozen rule on the new candidate books, beside Revolut X's and Coinbase's GBP books over the
same days.

The rule is `docs/agents/scripts/pr5/pr5_sim.py`'s `simulate`, imported read-only through CJ5's `VBook` and SCQ-VENUES'
`BarBook` (minute bars proven equal to the prints, scq_venues/scripts/calibrate_bars.py). Quotes 0.1 / 0.2 / 0.3 % either
side of fair, re-priced on a 0.05 % move of fair, exit at fair, 24-hour taker stop, a fill sized at most 10 % of the
minute's printed value. Fixed before any P&L was read:
* Windows end 2026-10-27 00:00 UTC. 12 months from 2025-10-27; "since TGBP" from 2026-04-23 (TGBP-USDC's first whole
  day); since 2026-08-24 (the week Revolut X's books tightened); the last 28 days, 2026-09-29 -> 10-27 (the comparison
  window: Revolut X's and Coinbase's GBP books are run only on it).
* Fair, in the book's quote units per coin, minute by minute:
  - a pegged cross (EURC-USDC, EURCV/USDC, TGBP-USDC): interbank EUR/USD or GBP/USD, divided by USDC's dollar value (PR5's
    F3: the median of Bitstamp USDC/USD's hourly closes over [t-24 h, t-1 h]). EURC, EURCV and TGBP are taken at
    exactly 1 EUR / 1 GBP (Circle and Coinbase convert EUR and EURC 1:1; review §3 checks the prints against it);
  - OKX USDG-EUR: USDG taken at exactly $1, divided by EUR/USD;
  - Coinbase's GBP books: USDC's or USDT's dollar value (F3 on Bitstamp USDC/USD, Coinbase USDT-USD) / GBP/USD, as SCQ-VENUES;
  - Revolut X's GBP books: PR5's own stored minute (X and fairU from `agent_quote_minutes`, PR5-OPT's committed pull), i.e.
    the fair LIVE quotes around.
  X(t) is the latest FX minute in [t-10, t-1], else dark: no entry quotes (weekends and FX closures), as PR5.
* Sizing in pounds: `size`, the 10 % cap and every P&L are pounds (a USDC-quoted book's unit is 1/GBP-USD pounds).
* Costs: maker 0 % on every venue (Coinbase's fx_stablecoin pairs, OKX EEA spot-only stablecoins, Revolut X; Bitstamp's
  is NOT verified and is a best case). The stop pays the venue's taker fee plus half the touch read 2026-10-27
  (results/snapshot_2026-10-27.json): Coinbase 0.0045 %, OKX 0.05 %, Bitstamp 0.01 % (assumed), Revolut X 0.09 %.
* Arms: through the quote at £10 / £50 / £100 a rung (£50 is the headline: LIVE's rung); at the price (optimistic) and one
  tick deeper with a double stop cost (stress) at £50; capacity at £300 and £1,000.
usage: python3 -I ov_sim.py   -> ../results/ov.json, ../results/daily_50.json
"""
import bisect, collections, datetime, gzip, json, multiprocessing as mp, os, random, statistics as st, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import ov_inputs as OI  # noqa: E402
import bars as BR  # noqa: E402  (SCQ-VENUES', on the path through ov_inputs)
import inputs as CI  # noqa: E402  (CJ5's)
from vbook import VBook, fair_f3  # noqa: E402
P = BR.P
M, DAY = 60000, 86400000
END = OI.END
W = {"12m": CI.ms("2025-10-27T00:00"), "since_tgbp": CI.ms("2026-04-23T00:00"), "since_08-24": CI.ms("2026-08-24T00:00"),
     "last_28d": CI.ms("2026-09-29T00:00")}
TAKER = {"coinbase": 0.000045, "okx": 0.0005, "bitstamp": 0.0001, "revx": 0.0009}
SIZES = (10.0, 50.0, 100.0)
ARMS = [(s, "through") for s in SIZES] + [(50.0, "at_price"), (50.0, "stress"), (300.0, "through"), (1000.0, "through")]
REVX = os.path.normpath(os.path.join(ROOT, "..", "pr5_opt", "data"))
ALL = [k for k in OI.BOOKS if os.path.exists(os.path.join(OI.IN, "bars_" + k.replace(":", "_") + ".json.gz"))] + ["revx:USDC-GBP", "revx:USDT-GBP"]


def series_at(ts, vs, t):
    k = bisect.bisect_right(ts, t - M) - 1
    return vs[k] if k >= 0 and ts[k] >= t - 10 * M else None


def day_of(t):
    return datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")


def build_new(key):
    venue, name, quote, coin, tick = OI.BOOKS[key]
    bars, meta = OI.load_bars(key)
    first = min(bars) * M // DAY * DAY
    t0 = W["last_28d"] if (venue == "coinbase" and quote == "GBP") else max(W["12m"], first)
    gb_t, gb_v = OI.load_gbpusd()
    usd = OI.load_usd_hourly()
    if quote == "USDC":
        ax_t, ax_v = (OI.load_eurusd() if coin in ("EURC", "EURCV") else (gb_t, gb_v))
        hrs = usd["USDC"]
    elif quote == "EUR":
        ax_t, ax_v = OI.load_eurusd()
        hrs = [(h, 1.0) for h, _ in usd["USDC"]]     # USDG (Paxos) taken at exactly $1: Kraken's USDG/USD sits at 1.0000/1.0001
    else:
        ax_t, ax_v = gb_t, gb_v
        hrs = usd[coin]
    ht, hc = [h[0] for h in hrs], [h[1] for h in hrs]
    B = BR.BarBook(key, {str(k): v for k, v in bars.items()}, t0, END, ax_t, ax_v, ht, hc, tick, gbp=True)
    if quote == "USDC":
        for i in range(B.n):
            t = t0 + i * M
            g = series_at(gb_t, gb_v, t)
            # constructed F = fairU / X; the cross's fair is X / fairU (X = EUR/USD or GBP/USD, fairU = USDC's dollar value)
            B.F[i] = (1.0 / B.F[i]) if B.F[i] else None
            B.X[i] = (1.0 / g) if (B.X[i] and g) else None
            if B.X[i] is None:
                B.F[i] = None
    if quote == "EUR":
        for i in range(B.n):
            g = series_at(gb_t, gb_v, t0 + i * M)
            B.X[i] = (B.Xreal[i] / g) if (B.X[i] and g) else None     # pounds per euro, as SCQ-VENUES
            if B.X[i] is None:
                B.F[i] = None
    B.meta = {"venue": venue, "quote": quote, "coin": coin, "tick": tick, "t0": t0, "first_print_day": day_of(first),
              "minutes_with_prints": len(B.by_min), "prints": meta["prints"], "candle_grade": venue == "bitstamp"}
    return B


def build_revx(key):
    book = key.split(":")[1]
    prints, mins = [], {}
    with gzip.open(os.path.join(REVX, "prints.txt.gz"), "rt") as f:
        for line in f:
            _id, b, ms, px, q, side = line.strip().split("|")
            if b == book:
                prints.append((int(ms), round(float(px) / 1e-4), float(q), side))
    prints.sort()
    for part in ("a", "b", "c"):
        with gzip.open(os.path.join(REVX, f"minutes_{part}.txt.gz"), "rt") as f:
            for line in f:
                b, ms, x, fu, _n = line.strip().split("|")
                if b == book:
                    mins[int(ms)] = (float(x) if x else None, float(fu) if fu else None)
    t0 = W["last_28d"]
    xt = sorted(k for k, v in mins.items() if v[0])
    B = VBook(key, prints, t0, END, xt, [mins[k][0] for k in xt], [], [], gbp=True, tick=1e-4)
    for i in range(B.n):
        t = t0 + i * M
        m = mins.get(t)
        # PR5's stored minute is the X and fairU it decided minute t on
        if m and m[0] and m[1]:
            B.X[i], B.F[i] = 1.0, m[1] / m[0]
        else:
            B.X[i], B.F[i] = None, None
    B.meta = {"venue": "revx", "quote": "GBP", "coin": book[:4], "tick": 1e-4, "t0": t0, "first_print_day": day_of(prints[0][0]),
              "minutes_with_prints": len(B.by_min), "prints": len(prints), "candle_grade": False}
    return B


def touch_of(key):
    snap = json.load(open(os.path.join(ROOT, "results", "snapshot_2026-10-27.json")))
    venue, name = key.split(":")
    if venue == "revx":
        return P.HALF_SPREAD
    raw = {"coinbase:EURC-USDC": "EURC-USDC", "coinbase:TGBP-USDC": "TGBP-USDC", "coinbase:USDC-GBP": "USDC-GBP",
           "coinbase:USDT-GBP": "USDT-GBP", "okx:EURC-USDC": "EURC-USDC", "okx:USDG-EUR": "USDG-EUR", "bitstamp:eurcvusdc": "eurcvusdc"}[key]
    ts = [r["touch_bps"] for s in snap["snapshots"] for r in s if r["venue"] == venue and r["book"] == raw and r.get("touch_bps") is not None]
    return st.median(ts) / 2 / 1e4


def run(B, key, size, arm):
    saved = (P.TICK, P.FEE, P.HALF_SPREAD, P.through)
    try:
        P.TICK = B.meta["tick"]
        P.HALF_SPREAD = touch_of(key)
        P.FEE = TAKER[key.split(":")[0]]
        if arm == "at_price":
            P.through = lambda side, price, q, thr: (q <= price) if side == "bid" else (q >= price)
        trips, orders = P.simulate(B, size=size, stress=(arm == "stress"))
    finally:
        P.TICK, P.FEE, P.HALF_SPREAD, P.through = saved
    return [{"t_entry": x["t_entry"], "t_exit": x["t_exit"], "pnl": x["pnl_usd"], "notional": x["notional_usd"], "how": x["how"],
             "k": x["k"], "side": x["side"]} for x in trips], sum(orders.values())


def stats(trips, size, t0, b_t0, t1=END):
    a = max(t0, b_t0)
    days = (t1 - a) / DAY
    sel = [x for x in trips if a <= x["t_entry"] < t1]
    cap = 6 * size
    tot = sum(x["pnl"] for x in sel)
    byday = collections.Counter()
    for x in sel:
        byday[day_of(x["t_entry"])] += x["pnl"]
    stops = [x for x in sel if x["how"] == "taker"]
    r4 = lambda v: None if v is None else round(v, 4)
    return {"from": day_of(a), "days": round(days, 2), "trips": len(sel), "pnl_gbp": r4(tot),
            "gbp_per_day": r4(tot / days) if days else None, "bps_per_day_of_capital": r4(1e4 * tot / days / cap) if days else None,
            "pct_per_year": r4(100 * tot / days * 365 / cap) if days else None,
            "bps_per_trip": r4(1e4 * tot / sum(x["notional"] for x in sel)) if sel else None,
            "trips_per_day": r4(len(sel) / days) if days else None, "stops": len(stops), "stop_pnl_gbp": r4(sum(x["pnl"] for x in stops)),
            "days_positive": sum(1 for v in byday.values() if v > 0), "days_negative": sum(1 for v in byday.values() if v < 0),
            "best_day_share": r4(max(byday.values()) / tot) if tot > 0 and byday else None,
            "by_k": {f"{k * 100:g}%": {"trips": sum(1 for x in sel if x["k"] == k), "pnl_gbp": r4(sum(x["pnl"] for x in sel if x["k"] == k))} for k in P.RUNGS},
            "by_side": {s: r4(sum(x["pnl"] for x in sel if x["side"] == s)) for s in ("bid", "ask")}}


def bootstrap(trips, t0, t1=END):
    D = [day_of(t) for t in range(t0 // DAY * DAY, t1, DAY)]
    byday = collections.Counter()
    for x in trips:
        if t0 <= x["t_entry"] < t1:
            byday[day_of(x["t_entry"])] += x["pnl"]
    v = [byday.get(d, 0.0) for d in D]
    rng = random.Random(20261027)
    s = sorted(sum(rng.choice(v) for _ in range(len(v))) for _ in range(2000))
    return {"days": len(v), "sum_gbp": round(sum(v), 4), "p05_gbp_per_day": round(s[100] / len(v), 4),
            "p95_gbp_per_day": round(s[1900] / len(v), 4), "share_draws_gt_0": round(sum(1 for x in s if x > 0) / 2000, 4)}


def volume(B, t0, t1=END):
    a = max(t0, B.meta["t0"])
    lastX, tot = None, 0.0
    for i in range(B.n):
        if B.X[i]:
            lastX = B.X[i]
        t = B.t0 + i * M
        if a <= t < t1 and i in B.qvol and lastX:
            tot += B.qvol[i] * lastX
    d = (t1 - a) / DAY
    return round(tot / d, 0) if d > 0 else None


def peg_check(B):
    """Median and p10/p90 of (print / fair - 1) in bps, by month, over lit minutes with prints (the last print a minute)."""
    by = collections.defaultdict(list)
    for i, ps in B.by_min.items():
        f = B.F[i]
        if not f:
            continue
        px = ps[-1][1] * B.meta["tick"]
        by[day_of(B.t0 + i * M)[:7]].append(1e4 * (px / f - 1))
    q = lambda a, p: sorted(a)[int(p * (len(a) - 1))]
    return {m: {"n": len(v), "median": round(st.median(v), 2), "p10": round(q(v, 0.1), 2), "p90": round(q(v, 0.9), 2)} for m, v in sorted(by.items())}


def _task(key):
    B = build_revx(key) if key.startswith("revx:") else build_new(key)
    out = {}
    for s, a in ARMS:
        tr, od = run(B, key, s, a)
        wins = dict({"whole": B.meta["t0"]}, **{w: t for w, t in W.items() if t >= B.meta["t0"]})
        out[f"{a}_{int(s)}"] = {"windows": {w: stats(tr, s, t, B.meta["t0"]) for w, t in wins.items()},
                                "orders_per_day": round(od / ((END - B.meta["t0"]) / DAY), 1)}
        if (s, a) == (50.0, "through"):
            out[f"{a}_{int(s)}"]["bootstrap_whole"] = bootstrap(tr, B.meta["t0"])
            out[f"{a}_{int(s)}"]["bootstrap_last_28d"] = bootstrap(tr, W["last_28d"])
            bm = collections.Counter()
            for x in tr:
                bm[day_of(x["t_entry"])[:7]] += x["pnl"]
            out[f"{a}_{int(s)}"]["by_month"] = {k: round(v, 4) for k, v in sorted(bm.items())}
            dd = collections.Counter()
            for x in tr:
                dd[day_of(x["t_entry"])] += x["pnl"]
            out["_daily_50"] = {k: round(v, 6) for k, v in sorted(dd.items())}
    meta = dict(B.meta, half_touch_bps=round(touch_of(key) * 1e4, 3), taker_fee=TAKER[key.split(":")[0]],
                lit_share=round(sum(1 for f in B.F if f) / B.n, 4),
                volume_gbp_per_day={w: volume(B, t) for w, t in W.items() if t >= B.meta["t0"]})
    meta["peg_check_bps"] = peg_check(B)
    return key, meta, out


def main():
    with mp.get_context("fork").Pool(4) as pool:
        res = pool.map(_task, ALL, chunksize=1)
    R, daily = {"windows": {k: day_of(v) for k, v in W.items()}, "end": day_of(END), "books": {}}, {}
    for key, meta, out in res:
        daily[key] = out.pop("_daily_50")
        R["books"][key] = {"meta": meta, "arms": out}
        w = out["through_50"]["windows"]
        for name in ("whole", "since_08-24", "last_28d"):
            if name in w:
                x = w[name]
                print(f"{key:22s} {name:10s} from {x['from']} £{x['pnl_gbp']:9.2f} £/day {x['gbp_per_day']:.3f} bps/day {x['bps_per_day_of_capital']:.2f} "
                      f"{x['pct_per_year']:.1f}%/yr trips {x['trips']} stops {x['stops']} bps/trip {x['bps_per_trip']}", flush=True)
    json.dump(R, open(os.path.join(ROOT, "results", "ov.json"), "w"), indent=1, sort_keys=True)
    json.dump(daily, open(os.path.join(ROOT, "results", "daily_50.json"), "w"), indent=0, sort_keys=True)


if __name__ == "__main__":
    main()
