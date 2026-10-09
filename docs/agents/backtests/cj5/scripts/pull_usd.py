"""The stablecoins' dollar value, hourly, 2020-03-31 -> 2026-10-09, keyless: fairU's inputs and the de-peg check.

PR5's fair proxy F3 is the median of its venue's USD book's hourly closes over the last 24 h. CoinJar's own USDC/USD and
USDT/USD books start on 2023-03-11 and are thin, so CJ5 reads deep external USD books instead (chosen before any P&L):
* Coinbase Exchange USDT-USD hourly candles (`/products/USDT-USD/candles?granularity=3600`, 300 a request);
* Bitstamp USDC/USD and USDT/USD hourly OHLC (`/api/v2/ohlc/{pair}/?step=3600&limit=1000&start=`), the only keyless
  hourly USDC/USD book found that pages back to 2021 (Coinbase has no USDC-USD book; Kraken's OHLC keeps 720 bars).
Raw bodies, concatenated, to RAW/usd/<name>.json.gz.
usage: python3 -I pull_usd.py RAW_DIR
"""
import gzip, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get

A = 1585612800   # 2020-03-31T00:00Z
Z = 1791504000   # 2026-10-09T00:00Z
assert time.strftime("%Y-%m-%dT%H:%M", time.gmtime(A)) == "2020-03-31T00:00"


def iso(s):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(s))


def coinbase(raw):
    pages = []
    for s in range(A, Z, 300 * 3600):
        e = min(Z, s + 300 * 3600) - 3600
        st, body = get(f"https://api.exchange.coinbase.com/products/USDT-USD/candles?granularity=3600&start={iso(s)}&end={iso(e)}")
        if st != 200:
            raise SystemExit(f"coinbase {s}: HTTP {st} {body[:200]}")
        pages.append({"start": s, "body": json.loads(body)})
        time.sleep(0.4)
    with gzip.open(os.path.join(raw, "coinbase_USDT-USD_3600.json.gz"), "wt") as f:
        json.dump(pages, f)
    print("coinbase pages", len(pages), sum(len(p["body"]) for p in pages), flush=True)


def bitstamp(raw, pair):
    pages, s = [], A
    while s < Z:
        st, body = get(f"https://www.bitstamp.net/api/v2/ohlc/{pair}/?step=3600&limit=1000&start={s}")
        if st != 200:
            raise SystemExit(f"bitstamp {pair} {s}: HTTP {st}")
        d = json.loads(body)
        rows = d["data"]["ohlc"]
        pages.append({"start": s, "body": d})
        time.sleep(1.0)
        if not rows:
            s += 1000 * 3600
            continue
        s = int(rows[-1]["timestamp"]) + 3600
    with gzip.open(os.path.join(raw, f"bitstamp_{pair}_3600.json.gz"), "wt") as f:
        json.dump(pages, f)
    print("bitstamp", pair, len(pages), sum(len(p["body"]["data"]["ohlc"]) for p in pages), flush=True)


if __name__ == "__main__":
    raw = os.path.join(sys.argv[1], "usd"); os.makedirs(raw, exist_ok=True)
    coinbase(raw)
    bitstamp(raw, "usdcusd")
    bitstamp(raw, "usdtusd")
