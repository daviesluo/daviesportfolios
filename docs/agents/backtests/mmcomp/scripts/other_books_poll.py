# MAKER-OTHER-BOOKS (2026-10-31): poll Revolut X's public order books, keyless GETs only, to find which other books the
# GBP stablecoin maker also quotes (reviews/2026-10-31-maker-other-books.md). Every CYCLE seconds it reads, one request
# every GAP seconds (the public bucket is about a token a second; the production recorder reads from another address),
# the top LIMIT levels a side of each book below and the UK tickers, and appends one JSON line per read to OUT (gzip).
# It places, cancels and signs nothing and reads no key.
#   SSL_CERT_FILE=<the proxy's CA bundle, when there is one> python3 -I other_books_poll.py <out.jsonl.gz> <minutes>
import gzip, json, sys, time, urllib.request

UK = ["USDT-GBP", "USDC-GBP", "USDT-USD", "USDC-USD",
      "BTC-GBP", "BTC-USD", "BTC-USDC", "ETH-GBP", "ETH-USD", "ETH-USDC", "SOL-GBP", "SOL-USD",
      "XRP-GBP", "XRP-USD", "ADA-GBP", "AVAX-GBP", "SUI-GBP", "LINK-GBP", "DOGE-GBP", "LTC-GBP", "PEPE-GBP"]
EEA = ["USDC-EUR", "BTC-EUR", "ETH-EUR"]
LIMIT, GAP, CYCLE = 50, 1.4, 150


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "maker-other-books-study"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def main(out, minutes):
    end = time.time() + 60 * minutes
    with gzip.open(out, "at") as f:
        while time.time() < end:
            t0 = time.time()
            reads = [(s, "UK") for s in UK] + [(s, "EEA") for s in EEA]
            for sym, reg in reads:
                try:
                    j = get(f"https://revx.revolut.com/api/2.0/public/order-book/{sym}?region={reg}&limit={LIMIT}")
                    d = j.get("data") or {}
                    row = {"t": time.time(), "book": sym, "region": reg, "vts": (j.get("metadata") or {}).get("timestamp"),
                           "bids": [[l["price"], l["quantity"], l.get("count")] for l in d.get("bids") or []],
                           "asks": [[l["price"], l["quantity"], l.get("count")] for l in d.get("asks") or []]}
                except Exception as e:  # a 429 or a timeout: record it and go on
                    row = {"t": time.time(), "book": sym, "region": reg, "error": str(e)[:120]}
                f.write(json.dumps(row) + "\n")
                f.flush()
                time.sleep(GAP)
            try:
                tk = get("https://revx.revolut.com/api/1.0/public/tickers?region=UK")
                keep = {s.replace("-", "/") for s in UK}
                f.write(json.dumps({"t": time.time(), "tickers": [x for x in tk.get("data") or [] if x.get("symbol") in keep]}) + "\n")
                f.flush()
            except Exception as e:
                f.write(json.dumps({"t": time.time(), "tickers_error": str(e)[:120]}) + "\n")
            time.sleep(max(5, CYCLE - (time.time() - t0)))


if __name__ == "__main__":
    main(sys.argv[1], float(sys.argv[2]))
