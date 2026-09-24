"""S3 (2026-09-24) — what a LIVE PR5 would send, hold and earn at $50, from the frozen simulator. A design study.

Imports the frozen `docs/agents/scripts/pr5/pr5_sim.py` UNCHANGED (its sha256 is checked below) and drives it the way
`posthoc_new_regime.py` does, on the committed inputs for the tightened market (fresh from 2026-08-26 00:00, the week
after the books tightened, to 2026-09-23 00:00) and, for the paper engine's first hours, on the public prints, USD-book
candles and Yahoo GBP/USD minutes pulled 2026-09-24 00:12 UTC into `inputs/` (the paper loop's own FX source; Exness,
the tested source, publishes September on 1 October).

Everything here is descriptive. The only configuration the evidence supports is the frozen one (PR5's pre-registration,
four weeks of paper per its spec); the alternatives below are priced so the order budget and the $50 arithmetic are
known, and choosing among them after seeing these numbers would be a new search needing its own pre-registration.
usage: python3 pr5_live_design.py   (from anywhere; writes pr5_live.json beside it)
"""
import collections, datetime, gzip, hashlib, json, os, statistics as st, sys, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "../../../.."))
SIM_DIR = os.path.join(ROOT, "docs/agents/scripts/pr5")
# The committed copy of PR5's frozen simulator: the pre-registered file (79ff67a2…) with only its input path changed
# (reviews/2026-09-23-pr5-study.md, "Files"). Its hash is pinned here so a later edit to it cannot pass silently.
FROZEN_SIM_SHA = "56fbad85ee4df6292f596188d091ad064d030180f33cefe3bd09089d7e772a1a"
sys.path.insert(0, SIM_DIR)
import pr5_sim as P   # noqa: E402

sim_sha = hashlib.sha256(open(os.path.join(SIM_DIR, "pr5_sim.py"), "rb").read()).hexdigest()
DAY = 86400000
M = P.M


def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M")


def run(books, size, reprice=None, rungs=None, only=None):
    """simulate() with the module's own knobs set for one call and restored after."""
    saved = (P.REPRICE, list(P.RUNGS))
    if reprice is not None: P.REPRICE = reprice
    if rungs is not None: P.RUNGS = rungs
    try:
        trips, orders = [], collections.Counter()
        for b in (only or P.BOOKS):
            tr, od = P.simulate(books[b], size=size)
            trips += tr; orders.update(od)
    finally:
        P.REPRICE, P.RUNGS = saved[0], saved[1]
    return trips, orders


def describe(trips, orders, t0, t1, capital):
    days = (t1 - t0) / DAY
    sel = [x for x in trips if t0 <= x["t_entry"] < t1]
    s = P.summarize(sel, t0, t1, capital, days)
    per_day = [orders.get(d, 0) for d in range(t0 // DAY, (t1 - 1) // DAY + 1)]
    fills_per_day = collections.Counter(x["t_entry"] // DAY for x in sel)
    s["orders_per_day"] = {"mean": round(sum(per_day) / len(per_day), 1), "max": max(per_day), "p90": sorted(per_day)[int(0.9 * (len(per_day) - 1))], "days": len(per_day)}
    s["fills_per_day_mean"] = round(len(sel) / days, 2)
    s["pct_per_year_on_capital"] = round(100 * s["pnl_usd"] / capital * 365 / days, 2) if capital else None
    s["days_positive"] = sum(1 for d in range(t0 // DAY, (t1 - 1) // DAY + 1) if sum(x["pnl_usd"] for x in sel if x["t_entry"] // DAY == d) > 0)
    # the venue's minimum order is 0.1 GBP (both books): a fill under it leaves an exit that cannot be placed alone
    s["trips_under_min_exit"] = sum(1 for x in sel if x["notional_usd"] < 0.1 * 1.36)
    s["pnl_of_trips_under_min_exit"] = round(sum(x["pnl_usd"] for x in sel if x["notional_usd"] < 0.1 * 1.36), 5)
    return s


out = {"frozenSimSha256": sim_sha, "frozenSimUnchanged": sim_sha == FROZEN_SIM_SHA, "configuration": P.CFG}
if sim_sha != FROZEN_SIM_SHA:
    raise SystemExit("pr5_sim.py is not the committed frozen copy")

# ── 1. the tightened market on the committed inputs (fresh from 2026-08-26, as posthoc_new_regime.py) ──
fx = P.fx_series()
B = {b: P.Book(b, P.PR3_0, P.END, fx) for b in P.BOOKS}
T0, T1 = P.PR3_0, P.END
trips100, ord100 = run(B, 100.0)
ref = describe(trips100, ord100, T0, T1, 1200.0)
posthoc = json.load(open(os.path.join(ROOT, "docs/agents/backtests/pr5/posthoc_new_regime.json")))["rung_100"]
out["fidelity"] = {
    "what": "the frozen rule at $100 rungs on 2026-08-26 → 09-23 against the committed posthoc_new_regime.json",
    "here": {"trips": ref["trips"], "pnl_usd": ref["pnl_usd"], "orders_per_day_mean": ref["orders_per_day"]["mean"], "orders_per_day_max": ref["orders_per_day"]["max"]},
    "committed": {"trips": posthoc["trips"], "pnl_usd": posthoc["pnl_usd"], "orders_per_day_mean": posthoc["orders_per_day_mean"], "orders_per_day_max": posthoc["orders_per_day_max"]},
}
assert ref["trips"] == posthoc["trips"] and abs(ref["pnl_usd"] - posthoc["pnl_usd"]) < 1e-9 and ref["orders_per_day"]["max"] == posthoc["orders_per_day_max"], out["fidelity"]

arms = {
    "frozen_1200": dict(size=100.0, capital=1200.0),
    "frozen_shape_at_50": dict(size=50 / 12, capital=50.0),
    "reprice_0.10pct_at_50": dict(size=50 / 12, capital=50.0, reprice=0.001),
    "reprice_0.20pct_at_50": dict(size=50 / 12, capital=50.0, reprice=0.002),
    "one_book_USDT_GBP_at_50": dict(size=50 / 6, capital=50.0, only=["USDT-GBP"]),
    "k0.1pct_only_at_50": dict(size=50 / 4, capital=50.0, rungs=[0.001]),
}
out["tightenedMarket"] = {"from": iso(T0), "to": iso(T1), "days": (T1 - T0) / DAY, "arms": {}}
daily = {}
for name, a in arms.items():
    tr, od = run(B, a["size"], a.get("reprice"), a.get("rungs"), a.get("only"))
    d = describe(tr, od, T0, T1, a["capital"])
    d["rungUsd"] = round(a["size"], 4)
    out["tightenedMarket"]["arms"][name] = d
    daily[name] = {iso(k * DAY)[:10]: {"orders": od.get(k, 0), "pnl": round(sum(x["pnl_usd"] for x in tr if x["t_entry"] // DAY == k), 5), "fills": sum(1 for x in tr if x["t_entry"] // DAY == k)} for k in range(T0 // DAY, (T1 - 1) // DAY + 1)}
    print(name, "trips", d["trips"], "pnl", d["pnl_usd"], "/day", d["pnl_usd_per_day"], "%/yr", d["pct_per_year_on_capital"], "orders/day", d["orders_per_day"], "fills/day", d["fills_per_day_mean"], "under-min", d["trips_under_min_exit"], d["pnl_of_trips_under_min_exit"], flush=True)
out["tightenedMarket"]["daily"] = daily

# The frozen shape at $50, by book and side, and its inventory at any one time (what the account must hold)
tr50, od50 = run(B, 50 / 12)
by = collections.defaultdict(lambda: [0, 0.0])
for x in tr50:
    k = f"{x['book']} {x['side']}"
    by[k][0] += 1; by[k][1] += x["pnl_usd"]
out["tightenedMarket"]["frozenAt50ByBookSide"] = {k: {"trips": v[0], "pnl_usd": round(v[1], 5)} for k, v in sorted(by.items())}
# open positions over time: at each minute, the notional held long (bids filled, waiting to sell) and short (asks filled)
events = []
for x in tr50:
    sgn = 1 if x["side"] == "bid" else -1
    events.append((x["t_entry"], sgn * x["notional_usd"], x["book"])); events.append((x["t_exit"], -sgn * x["notional_usd"], x["book"]))
events.sort()
held = collections.defaultdict(float); peak = collections.defaultdict(float); trough = collections.defaultdict(float)
for t, dv, b in events:
    held[b] += dv; peak[b] = max(peak[b], held[b]); trough[b] = min(trough[b], held[b])
out["tightenedMarket"]["frozenAt50Inventory"] = {b: {"maxLongStablecoinUsd": round(peak[b], 4), "maxShortStablecoinUsd": round(-trough[b], 4)} for b in P.BOOKS}

# ── 2. the paper engine's first hours, on fresh public data (2026-09-23 15:09 → 2026-09-24 00:00) ──
IN = os.path.join(HERE, "inputs")
g = lambda n: json.load(gzip.open(os.path.join(IN, n + ".json.gz"), "rt"))
fresh_prints = g("revx_gbp_prints")["prints"]
usd_h = g("revx_usd_hourly")["series"]
yahoo = g("yahoo_gbpusd_1m")["chart"]["chart"]["result"][0]
tmp = tempfile.mkdtemp(prefix="pr5_live_")
try:
    os.makedirs(os.path.join(tmp, "data", "trades")); os.makedirs(os.path.join(tmp, "data", "fx")); os.makedirs(os.path.join(tmp, "data", "candles"))
    shutil.copy(os.path.join(P.S, "config.json"), os.path.join(tmp, "config.json"))
    for b in P.BOOKS:
        rows = {}
        for line in gzip.open(os.path.join(P.S, "trades", b + ".jsonl.gz"), "rt"):
            r = json.loads(line); rows[r["id"]] = r
        for r in fresh_prints[b]:
            rows[r["id"]] = r
        with open(os.path.join(tmp, "data", "trades", b + ".jsonl"), "w") as f:
            for r in sorted(rows.values(), key=lambda z: (z["ts"], z["id"])):
                f.write(json.dumps(r, sort_keys=True) + "\n")
    for s in ("USDC-USD", "USDT-USD"):
        base = json.load(gzip.open(os.path.join(P.S, "candles", s + "_60.json.gz"), "rt"))
        rows = {int(r["start"]): r for r in base["rows"]}
        for r in usd_h[s]:
            rows[int(r["start"])] = r
        json.dump({"rows": [rows[k] for k in sorted(rows)]}, open(os.path.join(tmp, "data", "candles", s + "_60.json"), "w"))
    exn = json.load(gzip.open(os.path.join(P.S, "fx", "series_EXN.json.gz"), "rt"))
    last_exn = exn[-1][0]
    yts, ycl = yahoo["timestamp"], yahoo["indicators"]["quote"][0]["close"]
    yrows = [[t * 1000, c] for t, c in zip(yts, ycl) if c is not None and t * 1000 > last_exn]
    json.dump(exn + yrows, open(os.path.join(tmp, "data", "fx", "series_EXN.json"), "w"))
    # the overlap check: Yahoo against Exness on the last day both have
    ex_map = {t: v for t, v in exn}
    ov = [abs(c / ex_map[t * 1000] - 1) * 1e4 for t, c in zip(yts, ycl) if c is not None and t * 1000 in ex_map]
    saved_S = P.S
    P.S = tmp
    try:
        fx2 = P.fx_series()
        t0 = int(datetime.datetime(2026, 9, 23, 15, 9, tzinfo=datetime.timezone.utc).timestamp() * 1000)
        t1 = int(datetime.datetime(2026, 9, 24, 0, 0, tzinfo=datetime.timezone.utc).timestamp() * 1000)
        B2 = {b: P.Book(b, t0, t1, fx2) for b in P.BOOKS}
        paper = {}
        for name, size, cap in (("frozen_1200", 100.0, 1200.0), ("frozen_shape_at_50", 50 / 12, 50.0)):
            tr, od = run(B2, size)
            paper[name] = {"trips": len(tr), "pnl_usd": round(sum(x["pnl_usd"] for x in tr), 5), "orders": sum(od.values()),
                           "trip_list": [{k: (round(v, 6) if isinstance(v, float) else v) for k, v in x.items()} for x in tr]}
        out["paperPeriodPredicted"] = {
            "from": iso(t0), "to": iso(t1), "fxSource": "Exness to 2026-09-22 23:59, Yahoo GBPUSD=X 1m after (the paper loop's source)",
            "yahooVsExnessOverlap": {"minutes": len(ov), "medianAbsBps": round(st.median(ov), 3) if ov else None, "p95AbsBps": round(sorted(ov)[int(0.95 * (len(ov) - 1))], 3) if ov else None},
            "freshPrints": {b: len(fresh_prints[b]) for b in P.BOOKS},
            "minutesWithFx": {b: sum(1 for x in B2[b].X if x) for b in P.BOOKS}, "minutes": {b: B2[b].n for b in P.BOOKS},
            "arms": paper,
            "note": "what the frozen rule does from a fresh start at the paper engine's first minute; the engine's own record (agent_quote_trips / agent_quote_events) is the thing to compare, by the queries in the review",
        }
        print("paper period", json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "trip_list"} for k, v in paper.items()}), "fx overlap", out["paperPeriodPredicted"]["yahooVsExnessOverlap"], flush=True)
    finally:
        P.S = saved_S
finally:
    shutil.rmtree(tmp, ignore_errors=True)

# ── 3. inventory and the conversion a $50 start needs, at the pulled tickers ──
tick = {t["symbol"]: t for t in g("revx_tickers")["tickers"]["data"]}
pairs = g("revx_pairs")["pairs"]
X = yrows[-1][1] if yrows else None
gbp_usd = X
half = lambda s: (float(tick[s]["ask"]) - float(tick[s]["bid"])) / 2 / ((float(tick[s]["ask"]) + float(tick[s]["bid"])) / 2)
conv = {}
need = {"GBP (six bids, $4.17 each)": 25.0, "USDC (three asks)": 12.5, "USDT (three asks)": 12.5}
# USD → USDC / USDT: one taker buy each on the USD books; USD → GBP: buy USDC with USD, then sell it on USDC/GBP (no GBP/USD pair)
c_usdc = 12.5 * (0.0009 + half("USDC/USD"))
c_usdt = 12.5 * (0.0009 + half("USDT/USD"))
mid_usdcgbp = (float(tick["USDC/GBP"]["bid"]) + float(tick["USDC/GBP"]["ask"])) / 2
usdcusd = (float(tick["USDC/USD"]["bid"]) + float(tick["USDC/USD"]["ask"])) / 2
implied = usdcusd / mid_usdcgbp if mid_usdcgbp else None   # USD per GBP implied by the two USDC books
c_gbp_legs = 25.0 * (2 * 0.0009 + half("USDC/USD") + half("USDC/GBP"))
c_gbp_basis = 25.0 * ((implied / gbp_usd - 1) if (gbp_usd and implied) else 0.0)   # dollars paid per pound over interbank
out["inventoryAt50"] = {
    "need": need,
    "gbpUsdYahooLast": gbp_usd,
    "pairsListed": {s: (s in pairs) for s in ("USDC/USD", "USDT/USD", "USDC/GBP", "USDT/GBP", "USDT/USDC", "USDC/USDT", "GBP/USD", "USD/GBP")},
    "minOrderQuote": {s: pairs[s]["min_order_size_quote"] for s in ("USDC/GBP", "USDT/GBP", "USDC/USD", "USDT/USD")},
    "tickers": {s: {"bid": tick[s]["bid"], "ask": tick[s]["ask"]} for s in ("USDC/USD", "USDT/USD", "USDC/GBP", "USDT/GBP")},
    "conversionCostUsd": {"USD->USDC $12.50": round(c_usdc, 5), "USD->USDT $12.50": round(c_usdt, 5),
                          "USD->USDC->GBP $25 (two taker legs and two half-spreads)": round(c_gbp_legs, 5),
                          "the USDC/GBP book's gap to interbank on $25 (positive = GBP bought dearer than interbank)": round(c_gbp_basis, 5),
                          "impliedUsdPerGbpViaUsdcBooks": round(implied, 6) if implied else None},
}
out["inventoryAt50"]["conversionCostUsd"]["total"] = round(c_usdc + c_usdt + c_gbp_legs + c_gbp_basis, 5)
print(json.dumps(out["inventoryAt50"], indent=1), flush=True)

json.dump(out, open(os.path.join(HERE, "pr5_live.json"), "w"), indent=1, sort_keys=True)
print("wrote pr5_live.json")
