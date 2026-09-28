"""Read live_fx_measure.py's log beside Dukascopy's ticks for the same minutes: how often each keyless GBP/USD source
changes, how old its value is when it arrives, where it sits against Dukascopy's mid, and how far behind it runs.

Lag: for a shift s (ms), the source's value at local time t is compared with Dukascopy's mid at t - s, after removing
the source's median offset; the s with the smallest median |difference| (sampled every 250 ms over the window, s from
-3 s to +60 s in 100 ms steps) is its lag behind Dukascopy, polling included. Local time is this container's clock;
Dukascopy's is its own, so a lag carries the clock offset between them. On 2026-09-28 Bitstamp's websocket stamps
arrived a median 17-20 ms after their own time, so this clock and Bitstamp's agreed to tens of milliseconds.
usage: live_fx_analyze.py OUT.json TICKS_DIR|- LOG.jsonl[.gz] [LOG ...]      (one window per log)
"""
import bisect, gzip, json, os, statistics as st, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


KEYLESS_DOCS = {
    "truefx": {"url": "https://webrates.truefx.com/rates/connect.html?f=csv",
               "docs": "TrueFX Market Data Web API Developer Guide (copy: https://www.yumpu.com/en/document/view/7899027/truefx-market-data-api-developer-guide)",
               "limits": "unauthenticated: a snapshot of a subset of 10 pairs (GBP/USD among them), no incremental queries; no rate limit stated",
               "terms": "https://www.truefx.com/truefx-terms-and-conditions/: a licence 'for Your own internal purpose of viewing and analyzing FX market data', applications through the API 'solely for Your internal business purposes', no redistribution; https://www.truefx.com/truefx-market-data-faq/: 'real-time ... tick-by-tick', 'indicative, not executable' (Integral's aggregated stream)"},
    "kraken": {"url": "https://api.kraken.com/0/public/Ticker?pair=GBPUSD",
               "docs": "https://support.kraken.com/articles/206548367-what-are-the-api-rate-limits-",
               "limits": "'Calling the public endpoints at a frequency of 1 per second (or less) would remain within the rate limits', by IP"},
    "kraken_ws": {"url": "wss://ws.kraken.com/v2 (ticker, symbol GBP/USD, event_trigger bbo)",
                  "docs": "https://docs.kraken.com/api/docs/websocket-v2/ticker"},
    "bitstamp": {"url": "https://www.bitstamp.net/api/v2/ticker/gbpusd/", "docs": "https://www.bitstamp.net/api/",
                 "limits": "'all clients can make 400 requests per second', 'a default limit threshold of 10,000 requests per 10 minutes'"},
    "bitstamp_ws": {"url": "wss://ws.bitstamp.net (order_book_gbpusd)", "docs": "https://www.bitstamp.net/websocket/v2/"},
    "yahoo": {"url": "https://query1.finance.yahoo.com/v8/finance/chart/GBPUSD=X?interval=1m&range=1d (meta.regularMarketPrice)",
              "docs": "none published; the paper engine reads its minute bars in production",
              "limits": "undocumented; answered 429 to this container for the whole window and after it"},
}
SIGNUP_DOCS = {
    "OANDA (fxTrade Practice, free demo)": {
        "urls": ["https://developer.oanda.com/rest-live-v20/pricing-ep/", "https://developer.oanda.com/rest-live-v20/development-guide/",
                 "https://developer.oanda.com/rest-live-v20/best-practices/"],
        "update": "pricing stream: 'at most 4 prices per second (every 250 milliseconds) for each instrument'; heartbeats every 5 s",
        "limits": "REST '120 requests per second'; '20 active streams'; 'no more than 2 new connections per second'",
        "cost": "a free practice account", "fit": "sub-second push (Worker holding the stream) or a 1 s REST poll of /pricing"},
    "Finnhub (free key; the site already holds one)": {
        "urls": ["https://finnhub.io/docs/api/forex-rates", "https://finnhub.io/docs/api/forex-candles", "https://finnhub.io/docs/api/websocket-trades",
                 "https://finnhub.io/docs/api/rate-limit", "https://finnhub.io/pricing", "https://finnhub.io/terms-of-service"],
        "update": "/forex/rates and /forex/candle are marked 'Premium Access Required'; /quote is 'real-time quote data for US stocks'; the websocket (not premium; free plan 50 symbols) streams 'real-time trades for US stocks, forex and crypto' ('a price update will be sent with volume = 0'), except the FX brokers FXCM, Forex.com and FHFX; '1 API key can only open 1 connection at a time'",
        "limits": "free plan '60 API calls/minute' (pricing page); 'On top of all plan's limit, there is a 30 API calls/ second limit' (docs); no daily cap is stated either way",
        "cost": "free; 'Personal Use. Terms apply'; terms: no redistribution, 'Personal plan can't be used by any business'",
        "fit": "free REST has no forex price; only the websocket (e.g. OANDA:GBP_USD), which a minute-called Edge Function can hold for seconds only and a Worker could hold always"},
    "Trading 212 (the site already holds a key)": {
        "urls": ["https://docs.trading212.com/api", "https://docs.trading212.com/_spec/api.json", "https://www.trading212.com/legal-documentation/API-Terms_EN.pdf"],
        "update": "no quote, price or FX endpoint; GET /api/v0/equity/positions returns currentPrice (instrument currency) and walletImpact.currentValue / fxImpact (account currency), from which a USD holding's GBP/USD could be backed out; freshness not documented, and the terms say 'We do not guarantee their correctness, accuracy, completeness, or timeliness in any way' (5.1)",
        "limits": "/equity/positions 1 req / 1s, 'applied on a per-account basis, regardless of which API key is used' (shared with the site's own trading212 function); /equity/account/summary 1 req / 5s",
        "cost": "free with the account; API Terms 4.2(a) 'expressly prohibited from using our API for Algorithmic Trading purposes', 4.2(h) may not use it 'to monitor the availability, performance, or functionality of any part of the API, the Service Data, a third-party service or for any similar benchmarking purposes', 6.2 personal use 'and only for testing purposes'",
        "fit": "not a GBP/USD source: no FX endpoint, an undocumented rate hidden in a position valuation, and terms against this use"},
    "TraderMade": {"urls": ["https://tradermade.com/pricing", "https://tradermade.com/docs/restful-api"],
                   "update": "live endpoint https://marketdata.tradermade.com/api/v1/live, 'live sub-second data'",
                   "limits": "no free plan on the pricing page", "cost": "FX & Crypto £599/month (WebSocket included)", "fit": "paid"},
    "Twelve Data": {"urls": ["https://twelvedata.com/pricing"],
                    "update": "Basic: 'Real-time forex market data'; WebSocket only as '8 trial WS'",
                    "limits": "Basic (free): 8 API credits a minute, 800 a day (one call every 108 s on average); Grow $79/month: 377 a minute, 'No daily limits'",
                    "cost": "free Basic is 'Internal non-display usage'", "fit": "free tier too small for sub-minute; Grow could poll every second"},
    "Massive (formerly Polygon.io)": {"urls": ["https://massive.com/pricing?product=currencies"],
                                      "update": "Currencies Basic: 'End of Day Data', no WebSockets; Starter: 'Real-time Data' and 'WebSockets'",
                                      "limits": "Basic '5 API Calls / Minute'", "cost": "Starter $49/month", "fit": "paid"},
    "IG (demo account)": {"urls": ["https://labs.ig.com/faq.html", "https://labs.ig.com/streaming-api-guide.html"],
                          "update": "Lightstreamer streaming; MERGE mode 'regulate[s] the update rate'", "limits": "per app 60 non-trading requests a minute, per account 30; 40 subscriptions a connection",
                          "cost": "free demo, but a demo key needs a demo account opened with the live account's e-mail", "fit": "push via a held Lightstreamer session (Worker); REST far too slow"},
    "FXCM (demo account)": {"urls": ["https://fxcm-rest.readthedocs.io/en/latest/socketrestapispecs.html"],
                            "update": "push over a socket.io connection after subscribing", "limits": "not stated in the pages read",
                            "cost": "free demo token", "fit": "push via a held socket.io session (Worker)"},
    "Alpha Vantage": {"urls": ["https://www.alphavantage.co/premium/"], "limits": "'25 API requests per day' free; 75 a minute at $49.99/month",
                      "fit": "free tier far too small"},
}


def rows_of(path):
    op = gzip.open if path.endswith(".gz") else open
    return [json.loads(l) for l in op(path, "rt")]


def mid_of(r):
    if r.get("bid") is not None and r.get("ask") is not None:
        return (r["bid"] + r["ask"]) / 2
    return r.get("px")


def series(rows, src):
    t, v, age, lat = [], [], [], []
    for r in rows:
        if r["src"] != src or r.get("status") != 200:
            continue
        m = mid_of(r)
        if m is None:
            continue
        t.append(r["recv_ms"])
        v.append(m)
        if r.get("src_ms"):
            age.append(r["recv_ms"] - r["src_ms"])
        elif r.get("src_us"):
            age.append(r["recv_ms"] - r["src_us"] / 1000)
        if r.get("sent_ms"):
            lat.append(r["recv_ms"] - r["sent_ms"])
    o = np.argsort(np.array(t), kind="stable")
    return np.array(t)[o], np.array(v)[o], age, lat


def at(ts, vs, t):
    i = np.searchsorted(ts, t, side="right") - 1
    ok = i >= 0
    out = np.full(len(t), np.nan)
    out[ok] = vs[i[ok]]
    return out


def describe(rows, src, ref, t0, t1):
    ts, vs, age, lat = series(rows, src)
    sel = (ts >= t0) & (ts < t1)
    ts, vs = ts[sel], vs[sel]
    if len(ts) < 2:
        return {"observations": int(len(ts))}
    ch = np.r_[True, vs[1:] != vs[:-1]]
    cht = ts[ch]
    gaps = np.diff(cht) / 1000.0
    fails = [r for r in rows if r["src"] == src and r.get("status") not in (200, "connected") and t0 <= r["recv_ms"] < t1]
    out = {"observations": int(len(ts)), "failures": len(fails),
           "failure_statuses": sorted({str(r.get("status"))[:40] for r in fails})[:5],
           "value_changes": int(ch.sum() - 1), "changes_per_minute": round((ch.sum() - 1) / ((t1 - t0) / 60000), 2),
           "median_s_between_changes": round(float(np.median(gaps)), 2) if len(gaps) else None,
           "p90_s_between_changes": round(float(np.percentile(gaps, 90)), 2) if len(gaps) else None}
    if lat:
        out["request_ms_median"] = round(st.median(lat))
        out["request_ms_p90"] = round(float(np.percentile(lat, 90)))
    if age:
        out["age_at_arrival_ms_median"] = round(st.median(age))
        out["age_at_arrival_ms_p90"] = round(float(np.percentile(age, 90)))
    for name, (rt, rv) in (ref or {}).items():
        if name == src:
            continue
        out["vs_" + name] = lag_vs(ts, vs, rt, rv, t0, t1)
    return out


def lag_vs(ts, vs, rt, rv, t0, t1):
    """The shift s (ms) that makes the source at t closest to the reference at t - s (median absolute deviation of the
    difference, after its own median offset), from -3 s to +60 s in 100 ms steps; positive = the source is behind."""
    grid = np.arange(max(t0, ts[0], rt[0] + 60000), t1, 250)
    sv = at(ts, vs, grid)
    best = None
    for s in range(-3000, 60001, 100):
        r = at(rt, rv, grid - s)
        d = (sv / r - 1) * 1e4
        d = d[~np.isnan(d)]
        if len(d) < 100:
            continue
        med = float(np.median(d))
        e = float(np.median(np.abs(d - med)))
        if best is None or e < best[1]:
            best = (s, e, med, float(np.percentile(np.abs(d - med), 95)))
    r0 = at(rt, rv, grid)
    d0 = (sv / r0 - 1) * 1e4
    d0 = d0[~np.isnan(d0)]
    return {"offset_bps_median": round(float(np.median(d0)), 3),
            "abs_dev_bps_median_at_0": round(float(np.median(np.abs(d0 - np.median(d0)))), 3),
            "lag_ms_best": best[0] if best else None,
            "abs_dev_bps_median_at_best_lag": round(best[1], 3) if best else None,
            "abs_dev_bps_p95_at_best_lag": round(best[3], 3) if best else None}


def window(log, ticks_dir):
    rows = rows_of(log)
    t0 = min(r["recv_ms"] for r in rows) + 10000
    t1 = max(r["recv_ms"] for r in rows) - 5000
    refs = {}
    res = {"log": os.path.basename(log), "window_ms": [t0, t1], "minutes": round((t1 - t0) / 60000, 2), "sources": {}}
    if ticks_dir:
        import fastx as FX
        res["window_utc"] = [FX.iso(t0), FX.iso(t1)]
        tk = FX.load_ticks(ticks_dir, t0 // FX.H * FX.H - FX.H, (t1 // FX.H + 1) * FX.H)
        res["dukascopy_hours_missing"] = tk["missing"]
        if len(tk["ts"]):
            refs["dukascopy"] = (tk["ts"], tk["mid"])
            sel = (tk["ts"] >= t0) & (tk["ts"] < t1)
            mids = tk["mid"][sel]
            chg = int((mids[1:] != mids[:-1]).sum())
            rng = (float(mids.max()) / float(mids.min()) - 1) * 1e4 if len(mids) else None
            res["dukascopy"] = {"ticks": int(sel.sum()), "mid_changes": chg,
                                "mid_changes_per_minute": round(chg / ((t1 - t0) / 60000), 1),
                                "range_bps": round(rng, 2) if rng is not None else None}
    for other in ("truefx", "kraken_ws"):
        t_, v_, _, _ = series(rows, other)
        if len(t_):
            refs[other] = (t_, v_)
    for src in sorted({r["src"] for r in rows}):
        res["sources"][src] = describe(rows, src, refs, t0, t1)
        print(res["log"], src, json.dumps(res["sources"][src]))
    return res


def main():
    out, ticks_dir, logs = sys.argv[1], sys.argv[2], sys.argv[3:]
    res = {"windows": [window(log, ticks_dir if ticks_dir != "-" else None) for log in logs],
           "keyless_documented": KEYLESS_DOCS, "signup_documented": SIGNUP_DOCS}
    json.dump(res, open(out, "w"), indent=1)


if __name__ == "__main__":
    main()
