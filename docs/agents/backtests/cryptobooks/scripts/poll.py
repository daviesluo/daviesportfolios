# CRYPTOBOOKS (2026-10-31): a seconds-level sample of Revolut X's crypto books beside the outside venues' public prices,
# keyless GETs only (reviews/2026-10-31-crypto-books-deep.md). Two threads:
#  - Revolut X: one public request every GAP s (the public bucket is about a token a second, shared with this study's
#    trade pull from the same address; production reads from another), five slots a cycle: the four FOCUS books, then
#    one OTHER book in rotation, every sixth such slot the UK tickers (all 387 books' bid/ask) instead.
#  - Outside: Binance's bookTicker for every coin each second (one call), Kraken's Ticker (GBP books, GBP/USD, USDT/USD)
#    and Coinbase's USD tickers every two seconds.
# One JSON line a read to OUT_RX / OUT_EXT (gzip). It places, cancels and signs nothing and reads no key.
#   SSL_CERT_FILE=<the proxy's CA bundle> python3 -I poll.py <out_rx.jsonl.gz> <out_ext.jsonl.gz> <minutes>
import gzip, json, sys, threading, time, urllib.request

FOCUS = ["SOL-GBP", "XRP-GBP", "ETH-GBP", "PEPE-GBP"]
OTHER = ["BTC-GBP", "BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "PEPE-USD", "SUI-GBP", "SUI-USD", "HYPE-GBP", "HYPE-USD",
         "AVAX-GBP", "ADA-GBP", "DOGE-GBP", "LINK-GBP", "LINK-USD", "QNT-USD", "NEAR-USD", "XLM-USD", "BCH-GBP", "AAVE-GBP"]
COINS = ["BTC", "ETH", "SOL", "XRP", "PEPE", "SUI", "HYPE", "AVAX", "ADA", "DOGE", "LINK", "QNT", "NEAR", "XLM", "BCH", "AAVE"]
GAP, LIMIT = 1.4, 50
UA = {"User-Agent": "crypto-books-study"}


def get(url, timeout=15):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.load(r)


def rx(out, end):
    k, o, tk = 0, 0, 0
    with gzip.open(out, "at") as f:
        while time.time() < end:
            slot = k % 5
            if slot < 4:
                what = ("book", FOCUS[slot])
            else:
                tk += 1
                if tk % 6 == 0:
                    what = ("tickers", None)
                else:
                    what = ("book", OTHER[o % len(OTHER)])
                    o += 1
            t0 = time.time()
            try:
                if what[0] == "book":
                    j = get(f"https://revx.revolut.com/api/2.0/public/order-book/{what[1]}?region=UK&limit={LIMIT}")
                    d = j.get("data") or {}
                    row = {"t0": t0, "t": time.time(), "book": what[1], "vts": (j.get("metadata") or {}).get("timestamp"),
                           "b": [[l["price"], l["quantity"]] for l in d.get("bids") or []],
                           "a": [[l["price"], l["quantity"]] for l in d.get("asks") or []]}
                else:
                    j = get("https://revx.revolut.com/api/1.0/public/tickers?region=UK")
                    row = {"t0": t0, "t": time.time(),
                           "tickers": [[x["symbol"], x.get("bid"), x.get("ask"), x.get("index_price"), x.get("quote_volume_24h")]
                                       for x in j.get("data") or []]}
            except Exception as e:  # a 429 or a timeout: record it and go on
                row = {"t0": t0, "t": time.time(), "what": what, "error": str(e)[:120]}
            f.write(json.dumps(row) + "\n")
            f.flush()
            k += 1
            time.sleep(max(0.0, GAP - (time.time() - t0)))


def ext(out, end):
    syms = "%5B" + ",".join(f"%22{c}USDT%22" for c in COINS) + "%5D"
    cb = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "PEPE-USD", "SUI-USD"]
    n = 0
    with gzip.open(out, "at") as f:
        while time.time() < end:
            t0 = time.time()
            rows = []
            try:
                j = get(f"https://data-api.binance.vision/api/v3/ticker/bookTicker?symbols={syms}", 5)
                rows.append({"t0": t0, "t": time.time(), "src": "binance",
                             "q": {x["symbol"]: [x["bidPrice"], x["askPrice"]] for x in j}})
            except Exception as e:
                rows.append({"t0": t0, "t": time.time(), "src": "binance", "error": str(e)[:120]})
            if n % 2 == 0:
                t1 = time.time()
                try:
                    j = get("https://api.kraken.com/0/public/Ticker?pair=SOLGBP,XRPGBP,ETHGBP,XBTGBP,PEPEGBP,GBPUSD,USDTUSD", 5)
                    rows.append({"t0": t1, "t": time.time(), "src": "kraken",
                                 "q": {k: [v["b"][0], v["a"][0]] for k, v in (j.get("result") or {}).items()}})
                except Exception as e:
                    rows.append({"t0": t1, "t": time.time(), "src": "kraken", "error": str(e)[:120]})
                for p in cb:
                    t1 = time.time()
                    try:
                        j = get(f"https://api.exchange.coinbase.com/products/{p}/ticker", 5)
                        rows.append({"t0": t1, "t": time.time(), "src": "coinbase", "p": p, "q": [j.get("bid"), j.get("ask")],
                                     "tt": j.get("time")})
                    except Exception as e:
                        rows.append({"t0": t1, "t": time.time(), "src": "coinbase", "p": p, "error": str(e)[:120]})
            for r in rows:
                f.write(json.dumps(r) + "\n")
            f.flush()
            n += 1
            time.sleep(max(0.0, 1.0 - (time.time() - t0)))


if __name__ == "__main__":
    end = time.time() + 60 * float(sys.argv[3])
    a = threading.Thread(target=rx, args=(sys.argv[1], end))
    b = threading.Thread(target=ext, args=(sys.argv[2], end))
    a.start()
    b.start()
    a.join()
    b.join()
