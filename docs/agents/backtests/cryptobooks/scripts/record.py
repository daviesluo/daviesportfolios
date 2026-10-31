# CRYPTOBOOKS-2 (2026-10-31): a light seconds-level recorder of the books the strategy would quote, for the regime and
# the fair's sources, keyless GETs only. Two threads:
#  - Revolut X: the BOOKS (comma-separated) in turn, one public request every GAP s, top 20 levels a side;
#  - outside: Binance's book ticker for the books' coins every second; Kraken's ticker (the GBP books, GBP/USD, USDT/USD)
#    and Coinbase's USD tickers for the coins every two seconds; each with the venue's own timestamp where it gives one,
#    so the fair's staleness can be measured.
# One JSON line a read to OUT_RX / OUT_EXT (gzip, closed cleanly at the end).
#   SSL_CERT_FILE=<the proxy's CA bundle> python3 -I record.py <out_rx> <out_ext> <minutes> <gap s> XRP-GBP,SOL-GBP,ETH-GBP
import gzip, json, sys, threading, time, urllib.request

UA = {"User-Agent": "crypto-books-study"}
KR = {"XRP": "XRPGBP", "SOL": "SOLGBP", "ETH": "ETHGBP", "BTC": "XBTGBP", "SUI": "SUIGBP"}


def get(url, timeout=10):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.load(r)


def rx(out, end, gap, books):
    k = 0
    with gzip.open(out, "wt") as f:
        while time.time() < end:
            b = books[k % len(books)]
            k += 1
            t0 = time.time()
            try:
                j = get(f"https://revx.revolut.com/api/2.0/public/order-book/{b}?region=UK&limit=20")
                d = j.get("data") or {}
                row = {"t0": t0, "t": time.time(), "book": b, "vts": (j.get("metadata") or {}).get("timestamp"),
                       "b": [[l["price"], l["quantity"]] for l in d.get("bids") or []],
                       "a": [[l["price"], l["quantity"]] for l in d.get("asks") or []]}
            except Exception as e:
                row = {"t0": t0, "t": time.time(), "book": b, "error": str(e)[:120]}
            f.write(json.dumps(row) + "\n")
            f.flush()
            time.sleep(max(0.0, gap - (time.time() - t0)))


def ext(out, end, coins):
    syms = "%5B" + ",".join(f"%22{c}USDT%22" for c in coins) + "%5D"
    kr = ",".join([KR[c] for c in coins if c in KR] + ["GBPUSD", "USDTUSD"])
    n = 0
    with gzip.open(out, "wt") as f:
        while time.time() < end:
            t0 = time.time()
            rows = []
            try:
                j = get(f"https://data-api.binance.vision/api/v3/ticker/bookTicker?symbols={syms}", 5)
                rows.append({"t0": t0, "t": time.time(), "src": "binance", "q": {x["symbol"]: [x["bidPrice"], x["askPrice"]] for x in j}})
            except Exception as e:
                rows.append({"t0": t0, "t": time.time(), "src": "binance", "error": str(e)[:120]})
            if n % 2 == 0:
                t1 = time.time()
                try:
                    j = get(f"https://api.kraken.com/0/public/Ticker?pair={kr}", 5)
                    rows.append({"t0": t1, "t": time.time(), "src": "kraken", "q": {k: [v["b"][0], v["a"][0]] for k, v in (j.get("result") or {}).items()}})
                except Exception as e:
                    rows.append({"t0": t1, "t": time.time(), "src": "kraken", "error": str(e)[:120]})
                for c in coins:
                    t1 = time.time()
                    try:
                        j = get(f"https://api.exchange.coinbase.com/products/{c}-USD/ticker", 5)
                        rows.append({"t0": t1, "t": time.time(), "src": "coinbase", "p": c, "q": [j.get("bid"), j.get("ask")], "tt": j.get("time")})
                    except Exception as e:
                        rows.append({"t0": t1, "t": time.time(), "src": "coinbase", "p": c, "error": str(e)[:120]})
            for r in rows:
                f.write(json.dumps(r) + "\n")
            f.flush()
            n += 1
            time.sleep(max(0.0, 1.0 - (time.time() - t0)))


if __name__ == "__main__":
    end = time.time() + 60 * float(sys.argv[3])
    books = sys.argv[5].split(",")
    coins = sorted({b.split("-")[0] for b in books})
    a = threading.Thread(target=rx, args=(sys.argv[1], end, float(sys.argv[4]), books), daemon=True)
    b = threading.Thread(target=ext, args=(sys.argv[2], end, coins), daemon=True)
    a.start()
    b.start()
    a.join()
    b.join()
