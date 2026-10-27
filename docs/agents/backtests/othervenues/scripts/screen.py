"""OTHERVENUES step 1: every venue's keyless instrument list, filtered to stablecoin books against GBP, EUR or USD and to
stablecoin-against-stablecoin crosses (a pegged cross such as EURC-USDC, whose fair is EUR/USD).

Each listing is fetched once, its body's sha256 kept, and the matching books written to ../results/listings.json. Nothing
is signed; no key is read.
usage: python3 -I screen.py RAW_DIR
"""
import hashlib, json, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "results", "listings.json")
UA = "daviesportfolios-research/1.0 (public market data)"
STABLE = {"USDC", "USDT", "EURC", "EUROC", "EURCV", "PYUSD", "USDS", "DAI", "RLUSD", "FDUSD", "USDE", "USDG", "TGBP", "GBPT",
          "USD1", "PAX", "USDP", "GUSD", "TUSD", "EURQ", "EURR", "USDQ", "USDR", "EUROP", "EURI", "EUROE", "AEUR", "VGBP",
          "GBPA", "USDCV", "FRAX", "USDA", "EURA", "USD0", "GHO", "USDH", "USDT0", "EURE", "GBPE", "BGBP", "XSGD", "USDB",
          "USDX", "SUSDE", "SDAI", "BUIDL", "USTB", "USDM", "FDUSD", "UST", "UDC", "EUT", "XAUT", "PAXG"}
GOLD = {"XAUT", "PAXG"}
FIAT = {"GBP", "EUR", "USD"}
SOURCES = {
    "coinbase": "https://api.exchange.coinbase.com/products",
    "kraken": "https://api.kraken.com/0/public/AssetPairs",
    "bitstamp": "https://www.bitstamp.net/api/v2/trading-pairs-info/",
    "gemini": "https://api.gemini.com/v1/symbols",
    "okx": "https://www.okx.com/api/v5/public/instruments?instType=SPOT",
    "bitvavo": "https://api.bitvavo.com/v2/markets",
    "cryptocom": "https://api.crypto.com/exchange/v1/public/get-instruments",
    "bitfinex": "https://api-pub.bitfinex.com/v2/conf/pub:list:pair:exchange",
    "kucoin": "https://api.kucoin.com/api/v2/symbols",
    "onetrading": "https://api.onetrading.com/fast/v1/instruments",
    "luno": "https://api.luno.com/api/1/tickers",
    "bitpanda": "https://api.bitpanda.com/v1/ticker",
}


def get(url):
    for a in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as f:
                return f.read()
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(2 * (a + 1))
    raise SystemExit(f"failed {url}: {err}")


def norm(c):
    c = c.upper()
    return {"ZGBP": "GBP", "ZEUR": "EUR", "ZUSD": "USD", "XBT": "BTC", "EUROC": "EURC", "UST": "USDT", "UDC": "USDC", "EUT": "EURT"}.get(c, c)


def keep(b, q):
    b, q = norm(b), norm(q)
    if b in GOLD or q in GOLD:
        return False
    return (b in STABLE and (q in FIAT or q in STABLE)) or (b in FIAT and q in STABLE)


def pairs(venue, body):
    j = json.loads(body)
    out = []
    if venue == "coinbase":
        for p in j:
            if keep(p["base_currency"], p["quote_currency"]):
                out.append({"id": p["id"], "status": p["status"], "trading_disabled": p.get("trading_disabled"),
                            "fx_stablecoin": p.get("fx_stablecoin"), "tick": p.get("quote_increment"), "min_funds": p.get("min_market_funds"),
                            "post_only": p.get("post_only"), "limit_only": p.get("limit_only")})
    elif venue == "kraken":
        for k, v in j["result"].items():
            w = v.get("wsname", "")
            if "/" in w and keep(*w.split("/")):
                out.append({"id": w, "altname": v["altname"], "status": v.get("status"), "tick": v.get("tick_size"),
                            "ordermin": v.get("ordermin"), "maker_fee_pct_tier0": v["fees_maker"][0][1] if v.get("fees_maker") else None,
                            "taker_fee_pct_tier0": v["fees"][0][1] if v.get("fees") else None})
    elif venue == "bitstamp":
        for p in j:
            b, q = p["name"].split("/")
            if keep(b, q):
                out.append({"id": p["url_symbol"], "name": p["name"], "trading": p["trading"], "instant_and_market_orders": p.get("instant_and_market_orders"),
                            "min_order": p.get("minimum_order"), "counter_decimals": p.get("counter_decimals")})
    elif venue == "gemini":
        for s in j:
            S = s.upper()
            for q in ("GBP", "EUR", "USD", "USDC", "USDT", "GUSD", "RLUSD"):
                if S.endswith(q) and keep(S[: -len(q)], q):
                    out.append({"id": s})
                    break
    elif venue == "okx":
        for i in j["data"]:
            if keep(i["baseCcy"], i["quoteCcy"]):
                out.append({"id": i["instId"], "state": i["state"], "tick": i["tickSz"], "min": i["minSz"]})
    elif venue == "bitvavo":
        for m in j:
            if keep(m["base"], m["quote"]):
                out.append({"id": m["market"], "status": m.get("status")})
    elif venue == "cryptocom":
        for i in j["result"]["data"]:
            if i.get("inst_type") == "CCY_PAIR" and keep(i["base_ccy"], i["quote_ccy"]):
                out.append({"id": i["symbol"], "tradable": i.get("tradable")})
    elif venue == "bitfinex":
        for p in j[0]:
            b, q = (p.split(":") if ":" in p else (p[:3], p[3:]))
            if keep(b, q):
                out.append({"id": p})
    elif venue == "kucoin":
        for s in j["data"]:
            if keep(s["baseCurrency"], s["quoteCurrency"]):
                out.append({"id": s["symbol"], "enable": s.get("enableTrading")})
    elif venue == "onetrading":
        for i in j:
            b, q = i["base"]["code"], i["quote"]["code"]
            if keep(b, q):
                out.append({"id": f"{b}_{q}", "state": i.get("state")})
    elif venue == "luno":
        for t in j["tickers"]:
            p = t["pair"]
            for q in ("GBP", "EUR", "USD", "USDC", "USDT"):
                if p.endswith(q) and keep(p[: -len(q)], q):
                    out.append({"id": p, "status": t.get("status")})
                    break
    elif venue == "bitpanda":
        for c, v in j.items():
            if norm(c) in STABLE and c not in GOLD:
                out.append({"id": c, "quotes": sorted(k for k in v if k in FIAT)})
    return sorted(out, key=lambda x: x["id"])


def main(raw):
    os.makedirs(raw, exist_ok=True)
    res = {"read_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "venues": {}}
    for v, url in SOURCES.items():
        body = get(url)
        open(os.path.join(raw, f"listing_{v}.json"), "wb").write(body)
        res["venues"][v] = {"url": url, "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body), "books": pairs(v, body)}
        print(v, len(res["venues"][v]["books"]), [b["id"] for b in res["venues"][v]["books"]], flush=True)
    json.dump(res, open(OUT, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main(sys.argv[1])
