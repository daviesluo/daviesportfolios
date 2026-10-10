"""Each simulated book's touch, read once from the venues' keyless order books, five times 20 s apart; the median half-
touch is what the 24-hour stop pays on top of the taker fee (as CJ5 charged half CoinJar's touch).
usage: python3 -I read_touch.py   -> ../inputs/touch.json
"""
import datetime, json, os, statistics as st, sys, time
sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../cj5/scripts")))
from netget import get_json  # noqa: E402

BOOKS = {
    "coinbase:USDC-GBP": ("https://api.exchange.coinbase.com/products/USDC-GBP/book?level=1", "cb"),
    "coinbase:USDT-GBP": ("https://api.exchange.coinbase.com/products/USDT-GBP/book?level=1", "cb"),
    "coinbase:USDC-EUR": ("https://api.exchange.coinbase.com/products/USDC-EUR/book?level=1", "cb"),
    "coinbase:USDT-EUR": ("https://api.exchange.coinbase.com/products/USDT-EUR/book?level=1", "cb"),
    "okx:USDC-EUR": ("https://www.okx.com/api/v5/market/books?instId=USDC-EUR&sz=1", "okx"),
    "okx:USDT-EUR": ("https://www.okx.com/api/v5/market/books?instId=USDT-EUR&sz=1", "okx"),
    "okx:USDG-EUR": ("https://www.okx.com/api/v5/market/books?instId=USDG-EUR&sz=1", "okx"),
    "kraken:USDEEUR": ("https://api.kraken.com/0/public/Depth?pair=USDEEUR&count=1", "kr"),
    "kraken:USDGUSD": ("https://api.kraken.com/0/public/Depth?pair=USDGUSD&count=1", "kr"),
    "bitstamp:usdceur": ("https://www.bitstamp.net/api/v2/order_book/usdceur/", "bs"),
    "bitstamp:usdteur": ("https://www.bitstamp.net/api/v2/order_book/usdteur/", "bs"),
    "bitstamp:rlusdeur": ("https://www.bitstamp.net/api/v2/order_book/rlusdeur/", "bs"),
}


def top(kind, js):
    if kind == "cb":
        return float(js["bids"][0][0]), float(js["asks"][0][0])
    if kind == "okx":
        d = js["data"][0]; return float(d["bids"][0][0]), float(d["asks"][0][0])
    if kind == "kr":
        d = next(iter(js["result"].values())); return float(d["bids"][0][0]), float(d["asks"][0][0])
    return float(js["bids"][0][0]), float(js["asks"][0][0])


def main():
    reads = {k: [] for k in BOOKS}
    for _ in range(5):
        for k, (u, kind) in BOOKS.items():
            s, js, _b = get_json(u)
            if s == 200 and js:
                b, a = top(kind, js)
                reads[k].append({"at": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z", "bid": b, "ask": a,
                                 "touch_bps": round((a - b) / ((a + b) / 2) * 1e4, 3)})
        time.sleep(20)
    out = {k: {"reads": v, "median_touch_bps": st.median(x["touch_bps"] for x in v),
               "half_spread": round(st.median(x["touch_bps"] for x in v) / 2e4, 7)} for k, v in reads.items() if v}
    json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "inputs", "touch.json"), "w"), indent=1, sort_keys=True)
    for k, v in out.items():
        print(k, v["median_touch_bps"])


if __name__ == "__main__":
    main()
