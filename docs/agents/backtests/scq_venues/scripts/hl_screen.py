"""Hyperliquid's spot stablecoin books against PR5's frozen rule (2026-10-10, after SCQ-VENUES): a keyless screen.

* Books: every spot pair whose two tokens are both dollar stablecoins (`spotMetaAndAssetCtxs`, keyed by each context's
  `coin`), with their 24-hour notional volume. Only USDT0/USDC (`@166`) trades in size.
* History: `candleSnapshot` serves the newest 5,000 candles of an interval (1m reaches about 3.5 days back, 5m 17, 15m 52,
  1h 208) and `recentTrades` the last 10 prints, so there is no print history: the screen is CANDLE-GRADE, as Bitstamp's
  (a minute's low as a sell, its high as a buy, its close the last print, aggressor unknown).
* The anchor: both sides are dollars, so X is 1.0 every minute (no dark weekend) and fair is PR5's F3 on the book's own
  hourly closes (the median over [t-24 h, t-1 h]), as PR5 reads fairU from a venue's own USD book.
* Fees (Hyperliquid's fee page, read 2026-10-10): spot base tier 0.040 % maker / 0.070 % taker, and "Spot pairs between
  two spot quote assets have 80% lower taker fees, maker rebates, and user volume contribution"; the page's formula scales
  the maker rate by 0.2 on such a pair too (`scaleIfStablePair`): 0.008 % maker, 0.014 % taker. The simulator's maker leg
  is free, so each maker leg's 0.008 % of the trip's notional is taken off afterwards; the stop pays 0.014 % plus half a
  one-tick touch.
* Rule: `pr5_sim.simulate`, imported read-only through bars.py, $100 a rung on the 1-minute window (about 3.5 days);
  plus a description of the 15-minute bars (52 days): how often a bar reaches 10, 20 and 30 bps from fair.
usage: python3 -I hl_screen.py RAW_DIR   -> ../inputs/hl_candles_@166.json.gz, ../results/hl_screen.json
"""
import bisect, gzip, hashlib, json, os, statistics as st, sys, time, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import bars as BR  # noqa: E402
P = BR.P
M, H = 60000, 3600000
COIN = "@166"
MAKER, TAKER, TICK = 0.00008, 0.00014, 1e-5


def post(body):
    req = urllib.request.Request("https://api.hyperliquid.xyz/info", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "User-Agent": "daviesportfolios-research/1.0"})
    with urllib.request.urlopen(req, timeout=60) as f:
        return f.read()


def main(raw):
    os.makedirs(raw, exist_ok=True)
    now = int(time.time() * 1000)
    got, man = {}, {}
    meta = post({"type": "spotMetaAndAssetCtxs"})
    man["spotMetaAndAssetCtxs"] = hashlib.sha256(meta).hexdigest()
    m, ctxs = json.loads(meta)
    tok = {t["index"]: t for t in m["tokens"]}
    cx = {c["coin"]: c for c in ctxs}
    stables = {"USDC", "USDT0", "USDH", "USDE", "FEUSD", "USDHL", "RLUSD", "USDG", "USDXL", "HUSD", "DUSD", "USDN", "USDUC", "USDV", "USDY"}
    books = []
    for u in m["universe"]:
        a, b = (tok[i]["name"] for i in u["tokens"])
        if a in stables and b in stables:
            c = cx.get(u["name"], {})
            books.append({"coin": u["name"], "pair": f"{a}/{b}", "mid": c.get("midPx"), "mark": c.get("markPx"), "volume_usd_24h": round(float(c.get("dayNtlVlm", 0) or 0))})
    for iv, span in (("1m", 5000 * M), ("15m", 5000 * 15 * M), ("1h", 5000 * H)):
        body = post({"type": "candleSnapshot", "req": {"coin": COIN, "interval": iv, "startTime": now - span - H, "endTime": now}})
        man[f"candles_{iv}"] = hashlib.sha256(body).hexdigest()
        got[iv] = [[c["t"], c["o"], c["h"], c["l"], c["c"], c["v"], c["n"]] for c in json.loads(body)]
    rt = post({"type": "recentTrades", "coin": COIN})
    man["recentTrades_count"] = len(json.loads(rt))
    with gzip.GzipFile(os.path.join(ROOT, "inputs", f"hl_candles_{COIN}.json.gz"), "wb", mtime=0) as f:
        f.write(json.dumps({"coin": COIN, "read_at_ms": now, "sha256": man, "candles": got}, sort_keys=True).encode())
    hours = [(c[0], float(c[4])) for c in got["1h"] if c[0] + H <= now]
    ht, hc = [h[0] for h in hours], [h[1] for h in hours]
    # The 1-minute window, candle-grade, through PR5's simulator at $100 a rung.
    ones = [c for c in got["1m"] if c[0] + M <= now]
    t0, t1 = ones[0][0], ones[-1][0] + M
    bars = {str(c[0] // M): [round(float(c[3]) * 1e8), None, None, round(float(c[2]) * 1e8), c[0], round(float(c[4]) * 1e8), "unknown", -1, float(c[5]) * float(c[4]), 1]
            for c in ones if float(c[5]) > 0}
    fx_t = list(range(t0 - 20 * M, t1, M))
    B = BR.BarBook("USDT0/USDC", bars, t0, t1, fx_t, [1.0] * len(fx_t), ht, hc, TICK)
    saved = (P.TICK, P.FEE, P.HALF_SPREAD)
    P.TICK, P.FEE, P.HALF_SPREAD = TICK, TAKER, 0.000005
    try:
        tr, orders = P.simulate(B, size=100.0)
    finally:
        P.TICK, P.FEE, P.HALF_SPREAD = saved
    net = [x["pnl_usd"] - MAKER * x["notional_usd"] * (2 if x["how"] == "maker" else 1) for x in tr]
    days = (t1 - t0) / 86400000
    # The 15-minute bars: how far each reaches from fair.
    devs = []
    for c in got["15m"]:
        i, j = bisect.bisect_left(ht, c[0] - 24 * H), bisect.bisect_right(ht, c[0] - H)
        if j <= i:
            continue
        f = st.median(hc[i:j])
        devs.append(max(f / float(c[3]) - 1, float(c[2]) / f - 1))
    reach = {f"{k}bps": round(sum(1 for d in devs if d > k / 1e4) / len(devs), 4) for k in (5, 10, 20, 30)}
    mins = [abs(float(c[4]) / st.median(hc[bisect.bisect_left(ht, c[0] - 24 * H):bisect.bisect_right(ht, c[0] - H)]) - 1) * 1e4
            for c in ones if bisect.bisect_right(ht, c[0] - H) > bisect.bisect_left(ht, c[0] - 24 * H)]
    out = {"books": sorted(books, key=lambda b: -b["volume_usd_24h"]), "history_depth": {iv: [time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime(v[0][0] / 1000)), len(v)] for iv, v in got.items()},
           "recent_trades_served": man["recentTrades_count"],
           "fees": {"maker": MAKER, "taker": TAKER, "source": "hyperliquid.gitbook.io/hyperliquid-docs/trading/fees: base 0.040 % / 0.070 %, x0.2 on a pair of two spot quote assets (scaleIfStablePair)"},
           "sim_1m": {"window_days": round(days, 2), "trips": len(tr), "stops": sum(1 for x in tr if x["how"] == "taker"), "gross_usd": round(sum(x["pnl_usd"] for x in tr), 4),
                      "net_usd": round(sum(net), 4), "net_usd_per_year_on_600": round(sum(net) / days * 365, 2), "orders_per_day": round(sum(orders.values()) / days, 1)},
           "minute_close_vs_fair_bps": {"median": round(st.median(mins), 2), "p90": round(sorted(mins)[int(0.9 * (len(mins) - 1))], 2), "max": round(max(mins), 2)},
           "bars_15m_reaching": {"bars": len(devs), **reach}}
    json.dump(out, open(os.path.join(ROOT, "results", "hl_screen.json"), "w"), indent=1, sort_keys=True)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
