#!/usr/bin/env python3
"""Sample Bitget's stablecoin / fiat-quoted spot books once a minute, keyless.

Writes one JSON line per sample to raw/samples.jsonl:
  - Bitget v2 order book (20 levels) for every candidate book
  - Bitget v3 RPI order book for the candidates that support RPI
  - Bitget v2 ticker rows for the candidates (24 h volume, touch)
  - reference prices: Kraken (EUR/USD, USDT/USD, USDC/USD, USDT/EUR, USDC/EUR)
    and Binance's public mirror (EURUSDT, EURUSDC, USDCUSDT, USDTBRL)
Nothing here is signed; no key exists or is read.

usage: python3 sample_books.py N_SAMPLES INTERVAL_S
"""
import json, sys, time, urllib.request, urllib.error, os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "raw", "samples.jsonl")

BOOKS = [
    # fiat-quoted
    "USDCEUR", "USDTEUR", "BTCEUR", "ETHEUR", "SOLEUR", "XRPEUR", "AVAXEUR", "SUIEUR", "DOGEEUR", "BGBEUR", "GRAMEUR",
    "USDTUSD", "USDCUSD", "USDGOUSD",
    "USDTBRL", "BTCBRL", "ETHBRL", "BGBBRL",
    "USDTVND",
    # stablecoin base, stablecoin quote
    "USDCUSDT", "USDEUSDT", "USDEUSDC", "USD1USDT", "USD1USDC", "UUSDT", "UUSDC", "PYUSDUSDT", "RLUSDUSDT",
    "RLUSDUSDC", "TUSDUSDT", "USDSUSDT", "USDGOUSDT", "USDGOUSDC", "GHOUSDT", "USTCUSDT",
]
RPI = {"USDEUSDC", "USD1USDC", "RLUSDUSDT", "RLUSDUSDC"}


def get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "research-sampler/1.0"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
        return {"ok": True, "ms": int((time.time() - t0) * 1000), "json": json.loads(body)}
    except Exception as e:  # keep going; record the failure
        return {"ok": False, "err": repr(e)[:300]}


def one_sample():
    s = {"t_utc": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z", "t_ms": int(time.time() * 1000)}
    ob = {}
    for sym in BOOKS:
        ob[sym] = get(f"https://api.bitget.com/api/v2/spot/market/orderbook?symbol={sym}&type=step0&limit=20")
        time.sleep(0.07)
    s["orderbook"] = ob
    rpi = {}
    for sym in sorted(RPI):
        rpi[sym] = get(f"https://api.bitget.com/api/v3/market/rpi-orderbook?category=SPOT&symbol={sym}&limit=20")
        time.sleep(0.12)
    s["rpi_orderbook"] = rpi
    tk = get("https://api.bitget.com/api/v2/spot/market/tickers", timeout=30)
    if tk.get("ok"):
        tk["json"]["data"] = [x for x in tk["json"]["data"] if x["symbol"] in set(BOOKS)]
    s["tickers"] = tk
    s["kraken"] = get("https://api.kraken.com/0/public/Ticker?pair=EURUSD,USDTZUSD,USDCUSD,USDTEUR,USDCEUR")
    s["binance"] = get(
        "https://data-api.binance.vision/api/v3/ticker/bookTicker?symbols=%5B%22EURUSDT%22,%22EURUSDC%22,%22USDCUSDT%22,%22USDTBRL%22%5D"
    )
    return s


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    every = float(sys.argv[2]) if len(sys.argv) > 2 else 60.0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    for i in range(n):
        t0 = time.time()
        s = one_sample()
        with open(OUT, "a") as f:
            f.write(json.dumps(s) + "\n")
        bad = [k for k, v in s["orderbook"].items() if not v.get("ok")]
        print(f"{s['t_utc']} sample {i + 1}/{n} done in {time.time() - t0:.1f}s; failed books: {bad}", flush=True)
        if i < n - 1:
            time.sleep(max(0.0, every - (time.time() - t0)))


if __name__ == "__main__":
    main()
