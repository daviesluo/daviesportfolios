"""Public, keyless pulls for S2 (trend-4h go-live validation) and S3 (PR5 live design), 2026-09-24.
Every Revolut X request is paced >= 1.2 s apart. No key, no signed call, no order.
usage: pull_public.py OUTDIR
"""
import json, os, sys, time, urllib.request, urllib.error, gzip

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
_last = [0.0]
LOG = []


def get(url, pace=1.2, headers=None):
    wait = _last[0] + pace - time.time()
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "Mozilla/5.0 (research; daviesportfolios)"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read()
                LOG.append({"url": url, "status": r.status, "t": round(time.time(), 3), "bytes": len(body)})
                return r.status, json.loads(body)
        except urllib.error.HTTPError as e:
            LOG.append({"url": url, "status": e.code, "t": round(time.time(), 3)})
            if e.code == 429:
                time.sleep(float(e.headers.get("Retry-After", "2000")) / 1000 + 1)
                continue
            return e.code, None
        except Exception as e:  # noqa: BLE001
            LOG.append({"url": url, "status": 0, "err": str(e)[:200], "t": round(time.time(), 3)})
            time.sleep(2)
    return 0, None


def save(name, obj):
    with gzip.open(os.path.join(OUT, name + ".json.gz"), "wt") as f:
        json.dump(obj, f, sort_keys=True)


now_ms = int(time.time() * 1000)
meta = {"pulled_at_ms": now_ms, "pulled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now_ms / 1000))}

# ---- Kraken OHLC (the loop's signal venue): 4h and daily, the 720 most recent each
KR = {"BTC/USD": "XBTUSD", "ETH/USD": "ETHUSD", "SOL/USD": "SOLUSD", "AVAX/USD": "AVAXUSD", "SUI/USD": "SUIUSD"}
kraken = {}
for sym, alt in KR.items():
    for iv in (240, 1440):
        st, d = get(f"https://api.kraken.com/0/public/OHLC?pair={alt}&interval={iv}", pace=1.1)
        kraken[f"{sym}|{iv}"] = {"status": st, "data": d}
save("kraken_ohlc", {"meta": meta, "series": kraken})
print("kraken done", flush=True)

# ---- Revolut X public: pair config, tickers, order books (UK)
st, pairs = get("https://revx.revolut.com/api/1.0/public/configuration/pairs")
save("revx_pairs", {"meta": meta, "status": st, "pairs": pairs})
syms = ["BTC-USD", "ETH-USD", "SOL-USD", "AVAX-USD", "SUI-USD", "USDC-GBP", "USDT-GBP", "USDC-USD", "USDT-USD"]
st, tick = get("https://revx.revolut.com/api/1.0/public/tickers?symbols=" + ",".join(syms) + "&region=UK")
save("revx_tickers", {"meta": meta, "status": st, "tickers": tick})
books = {}
for s in syms:
    st, ob = get(f"https://revx.revolut.com/api/2.0/public/order-book/{s}?region=UK&limit=100")
    books[s] = {"status": st, "book": ob, "t": int(time.time() * 1000)}
save("revx_books", {"meta": meta, "books": books})
print("revx config/tickers/books done", flush=True)

# ---- Revolut X UK candles: 4h for 40 days, 1m from 2026-09-20 12:00 UTC to now (the paper row's life), five coins
T_1M_FROM = 1789905600000   # 2026-09-20T12:00:00Z
T_4H_FROM = now_ms - 40 * 86400000
revx = {}
for s in ["BTC-USD", "ETH-USD", "SOL-USD", "AVAX-USD", "SUI-USD"]:
    rows = {}
    st, d = get(f"https://revx.revolut.com/api/1.0/public/candles/{s}?interval=240&since={T_4H_FROM}&until={now_ms}&region=UK")
    for r in (d or {}).get("data", []) or []:
        rows[int(r["start"])] = r
    revx[f"{s}|240"] = [rows[k] for k in sorted(rows)]
    rows = {}
    t = T_1M_FROM
    while t < now_ms:
        u = min(now_ms, t + 1000 * 60000)
        st, d = get(f"https://revx.revolut.com/api/1.0/public/candles/{s}?interval=1&since={t}&until={u}&region=UK")
        for r in (d or {}).get("data", []) or []:
            rows[int(r["start"])] = r
        t = u
    revx[f"{s}|1"] = [rows[k] for k in sorted(rows)]
    print(s, len(revx[f"{s}|240"]), len(revx[f"{s}|1"]), flush=True)
save("revx_candles", {"meta": meta, "series": revx})

# ---- S3: the two GBP books' prints from 2026-09-23 00:00 UTC (where the committed inputs end) to now
T_PR_FROM = 1790121600000   # 2026-09-23T00:00:00Z
prints = {}
for s in ["USDC-GBP", "USDT-GBP"]:
    out = {}
    a = T_PR_FROM
    while a < now_ms:
        b = min(now_ms, a + 86400000)
        cursor, page = "", 0
        while True:
            url = f"https://revx.revolut.com/api/1.0/public/trades/all?symbol={s}&start_date={a}&end_date={b}&limit=100" + (f"&cursor={cursor}" if cursor else "")
            st, d = get(url)
            if st != 200 or not isinstance(d, dict):
                print("trades fail", s, st, flush=True)
                break
            for r in d.get("data", []):
                out[r["id"]] = {"id": r["id"], "ts": int(r["timestamp"]), "price": r["price"], "qty": r["quantity"], "side": r["side"], "region": r.get("region")}
            cursor = (d.get("metadata") or {}).get("next_cursor") or ""
            page += 1
            if not cursor or page > 200:
                break
        a = b
    prints[s] = sorted(out.values(), key=lambda x: (x["ts"], x["id"]))
    print(s, "prints", len(prints[s]), flush=True)
save("revx_gbp_prints", {"meta": meta, "from_ms": T_PR_FROM, "prints": prints})

# ---- S3: USD books' UK hourly candles (fair value), 2026-09-18 → now
usd = {}
for s in ["USDC-USD", "USDT-USD"]:
    st, d = get(f"https://revx.revolut.com/api/1.0/public/candles/{s}?interval=60&since={1790121600000 - 5 * 86400000}&until={now_ms}&region=UK")
    usd[s] = (d or {}).get("data", [])
save("revx_usd_hourly", {"meta": meta, "series": usd})

# ---- S3: GBP/USD minutes from Yahoo (the paper loop's own source) for the last five days
st, y = get("https://query1.finance.yahoo.com/v8/finance/chart/GBPUSD=X?interval=1m&range=5d", pace=0.5)
save("yahoo_gbpusd_1m", {"meta": meta, "status": st, "chart": y})

save("_requests", {"meta": meta, "log": LOG})
print("done", meta, flush=True)
