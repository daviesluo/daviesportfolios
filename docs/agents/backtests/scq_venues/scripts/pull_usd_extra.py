"""RLUSD's dollar value for Bitstamp's RLUSD/EUR book: Bitstamp's RLUSD/USD hourly OHLC from 2024-09-24, keyless
(https://www.bitstamp.net/api/v2/ohlc/rlusdusd/?step=3600&limit=1000&start=<s>). USDC's and USDT's are CJ5's committed
series; USDG's and USDe's are built from Kraken's USDG/USD and USDE/USD prints (pull_kraken.py).
usage: python3 -I pull_usd_extra.py RAW_DIR
"""
import hashlib, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pull_coinbase import START, END, fetch  # noqa: E402


def main(raw):
    d = os.path.join(raw, "usd"); os.makedirs(d, exist_ok=True)
    pages, s = [], START // 1000 - 7 * 86400
    while s < END // 1000:
        body = fetch(f"https://www.bitstamp.net/api/v2/ohlc/rlusdusd/?step=3600&limit=1000&start={s}")
        pages.append({"start": s, "sha256": hashlib.sha256(body).hexdigest(), "body": json.loads(body)})
        s += 1000 * 3600
        time.sleep(1)
    json.dump(pages, open(os.path.join(d, "bitstamp_rlusdusd_3600.json"), "w"))
    print("pages", len(pages))


if __name__ == "__main__":
    main(sys.argv[1])
