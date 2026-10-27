"""OTHERVENUES step 2: one keyless snapshot of every candidate book: its 24-hour volume, its touch, where its mid sits
against an interbank fair, and how much rests ahead of a quote 0.1 / 0.2 / 0.3 % from that fair.

Fair (quote units per base unit) is interbank FX times the pegs taken as 1: a EUR coin is worth 1 EUR, a dollar coin 1 USD,
TGBP 1 GBP. GBP/USD and EUR/USD are passed on the command line (read from PR5's and the Coinbase test's stored minutes,
`agent_quote_inputs` kind 'fx' and `cb_quote_inputs` kind 'fx:EURUSD', SELECT only). A book with no FX fair (XSGD) gets
only its touch and volume. Volume is turned into pounds through the same FX.
usage: python3 -I snapshot.py OUT_JSON GBPUSD EURUSD [REPEAT]   (REPEAT snapshots 20 s apart; default 3)
"""
import json, sys, time, urllib.request

UA = "daviesportfolios-research/1.0 (public market data)"
EUR_COINS = {"EURC", "EURCV", "EURQ", "EURR", "EUROP", "EUR"}
GBP_COINS = {"TGBP", "GBP"}
USD_COINS = {"USD", "USDC", "USDT", "UST", "USDG", "USDS", "USD1", "PYUSD", "RLUSD", "GUSD", "PAX", "USDQ", "USDR", "DAI", "USDE"}

# venue, book id, base, quote
BOOKS = [
    ("coinbase", "EURC-USDC", "EURC", "USDC"), ("coinbase", "TGBP-USDC", "TGBP", "USDC"), ("coinbase", "XSGD-USDC", "XSGD", "USDC"),
    ("coinbase", "USDC-GBP", "USDC", "GBP"), ("coinbase", "USDC-EUR", "USDC", "EUR"), ("coinbase", "USDT-GBP", "USDT", "GBP"),
    ("coinbase", "USDT-EUR", "USDT", "EUR"), ("coinbase", "USDS-USD", "USDS", "USD"), ("coinbase", "USD1-USD", "USD1", "USD"),
    ("coinbase", "PAX-USD", "PAX", "USD"), ("coinbase", "USDT-USDC", "USDT", "USDC"),
    ("kraken", "EURCEUR", "EURC", "EUR"), ("kraken", "EURCUSD", "EURC", "USD"), ("kraken", "EURCUSDC", "EURC", "USDC"),
    ("kraken", "TGBPUSD", "TGBP", "USD"), ("kraken", "EUROPEUR", "EUROP", "EUR"), ("kraken", "EURQEUR", "EURQ", "EUR"),
    ("kraken", "USDCGBP", "USDC", "GBP"), ("kraken", "USDTGBP", "USDT", "GBP"), ("kraken", "USDCEUR", "USDC", "EUR"),
    ("kraken", "USDTEUR", "USDT", "EUR"), ("kraken", "RLUSDEUR", "RLUSD", "EUR"), ("kraken", "USDSEUR", "USDS", "EUR"),
    ("kraken", "USDGUSD", "USDG", "USD"),
    ("bitstamp", "eurceur", "EURC", "EUR"), ("bitstamp", "eurcusdc", "EURC", "USDC"), ("bitstamp", "eurcveur", "EURCV", "EUR"),
    ("bitstamp", "eurcvusdc", "EURCV", "USDC"), ("bitstamp", "usdceur", "USDC", "EUR"), ("bitstamp", "usdteur", "USDT", "EUR"),
    ("bitstamp", "rlusdeur", "RLUSD", "EUR"),
    ("okx", "EURC-USDC", "EURC", "USDC"), ("okx", "USDC-EUR", "USDC", "EUR"), ("okx", "USDG-EUR", "USDG", "EUR"),
    ("gemini", "eurusdc", "EUR", "USDC"), ("gemini", "gusdgbp", "GUSD", "GBP"),
    ("cryptocom", "EUR_USDT", "EUR", "USDT"), ("cryptocom", "EURC_USD", "EURC", "USD"),
    ("bitfinex", "GBPUST", "GBP", "USDT"), ("bitfinex", "EURUST", "EUR", "USDT"), ("bitfinex", "EURR:EUR", "EURR", "EUR"),
    ("bitfinex", "EURQ:EUR", "EURQ", "EUR"),
]


def get(url):
    for a in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as f:
                return json.loads(f.read())
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(2)
    return {"_error": str(err)}


def usd_value(c, gbpusd, eurusd):
    if c in USD_COINS:
        return 1.0
    if c in EUR_COINS:
        return eurusd
    if c in GBP_COINS:
        return gbpusd
    return None


def book_and_volume(venue, bid):
    """-> (bids [(p, q)], asks [(p, q)], 24 h base volume)"""
    if venue == "coinbase":
        b = get(f"https://api.exchange.coinbase.com/products/{bid}/book?level=2")
        s = get(f"https://api.exchange.coinbase.com/products/{bid}/stats")
        f = lambda xs: [(float(p), float(q)) for p, q, *_ in xs]
        return f(b.get("bids", [])), f(b.get("asks", [])), float(s.get("volume", 0) or 0)
    if venue == "kraken":
        d = get(f"https://api.kraken.com/0/public/Depth?pair={bid}&count=100").get("result", {})
        t = get(f"https://api.kraken.com/0/public/Ticker?pair={bid}").get("result", {})
        d, t = next(iter(d.values()), {}), next(iter(t.values()), {})
        f = lambda xs: [(float(p), float(q)) for p, q, *_ in xs]
        return f(d.get("bids", [])), f(d.get("asks", [])), float(t.get("v", [0, 0])[1])
    if venue == "bitstamp":
        d = get(f"https://www.bitstamp.net/api/v2/order_book/{bid}/")
        t = get(f"https://www.bitstamp.net/api/v2/ticker/{bid}/")
        f = lambda xs: [(float(p), float(q)) for p, q in xs[:200]]
        return f(d.get("bids", [])), f(d.get("asks", [])), float(t.get("volume", 0) or 0)
    if venue == "okx":
        d = get(f"https://www.okx.com/api/v5/market/books?instId={bid}&sz=100").get("data", [{}])[0]
        t = get(f"https://www.okx.com/api/v5/market/ticker?instId={bid}").get("data", [{}])[0]
        f = lambda xs: [(float(x[0]), float(x[1])) for x in xs]
        return f(d.get("bids", [])), f(d.get("asks", [])), float(t.get("vol24h", 0) or 0)
    if venue == "gemini":
        d = get(f"https://api.gemini.com/v1/book/{bid}?limit_bids=100&limit_asks=100")
        t = get(f"https://api.gemini.com/v1/pubticker/{bid}")
        f = lambda xs: [(float(x["price"]), float(x["amount"])) for x in xs]
        base = next((k for k in t.get("volume", {}) if k.lower() == bid[:len(k)].lower() and k.upper() not in ("TIMESTAMP",)), None)
        return f(d.get("bids", [])), f(d.get("asks", [])), float(t.get("volume", {}).get(base, 0) or 0)
    if venue == "cryptocom":
        d = get(f"https://api.crypto.com/exchange/v1/public/get-book?instrument_name={bid}&depth=50").get("result", {}).get("data", [{}])[0]
        t = get(f"https://api.crypto.com/exchange/v1/public/get-tickers?instrument_name={bid}").get("result", {}).get("data", [{}])[0]
        f = lambda xs: [(float(x[0]), float(x[1])) for x in xs]
        return f(d.get("bids", [])), f(d.get("asks", [])), float(t.get("v", 0) or 0)
    if venue == "bitfinex":
        sym = "t" + bid
        d = get(f"https://api-pub.bitfinex.com/v2/book/{sym}/P0?len=100")
        t = get(f"https://api-pub.bitfinex.com/v2/ticker/{sym}")
        if isinstance(d, dict):
            return [], [], 0.0
        bids = [(x[0], x[2]) for x in d if x[2] > 0]
        asks = [(x[0], -x[2]) for x in d if x[2] < 0]
        return bids, asks, float(t[7]) if isinstance(t, list) and len(t) > 7 else 0.0
    raise ValueError(venue)


def one(venue, bid, base, quote, gbpusd, eurusd):
    bids, asks, vol = book_and_volume(venue, bid)
    bids.sort(key=lambda x: -x[0]); asks.sort(key=lambda x: x[0])
    ub, uq = usd_value(base, gbpusd, eurusd), usd_value(quote, gbpusd, eurusd)
    fair = ub / uq if ub and uq else None
    r = {"venue": venue, "book": bid, "base": base, "quote": quote, "fair": fair,
         "vol24h_base": vol, "vol24h_gbp": round(vol * ub / gbpusd, 0) if ub else None}
    if not bids or not asks:
        r["empty"] = True
        return r
    bb, ba = bids[0][0], asks[0][0]
    mid = (bb + ba) / 2
    r.update({"bid": bb, "ask": ba, "touch_bps": round((ba - bb) / mid * 1e4, 2),
              "bid_size_gbp": round(bids[0][1] * bb * uq / gbpusd, 0) if uq else None,
              "ask_size_gbp": round(asks[0][1] * ba * uq / gbpusd, 0) if uq else None})
    if fair:
        r["mid_vs_fair_bps"] = round((mid / fair - 1) * 1e4, 2)
        r["bid_vs_fair_bps"] = round((bb / fair - 1) * 1e4, 2)
        r["ask_vs_fair_bps"] = round((ba / fair - 1) * 1e4, 2)
        for k in (10, 20, 30):
            pb, pa = fair * (1 - k / 1e4), fair * (1 + k / 1e4)
            # what rests at a better price than our quote (queue ahead of a k-bps rung), in pounds
            ahead_b = sum(q * p for p, q in bids if p >= pb) * uq / gbpusd
            ahead_a = sum(q * p for p, q in asks if p <= pa) * uq / gbpusd
            r[f"ahead_gbp_k{k}"] = [round(ahead_b, 0), round(ahead_a, 0)]
    return r


def main(out, gbpusd, eurusd, repeat=3):
    snaps = []
    for n in range(repeat):
        t = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        rows = [dict(one(*b, gbpusd, eurusd), t=t) for b in BOOKS]
        snaps.append(rows)
        if n == 0:
            for r in rows:
                print(json.dumps(r), flush=True)
        if n + 1 < repeat:
            time.sleep(20)
    json.dump({"gbpusd": gbpusd, "eurusd": eurusd, "snapshots": snaps}, open(out, "w"), indent=0, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 3)
