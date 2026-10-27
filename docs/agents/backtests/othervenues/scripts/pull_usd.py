"""The coins' dollar value for PR5's F3 fair, hourly, 2025-09-01 -> 2026-10-27 00:00 UTC, keyless, as SCQ-VENUES and CJ5 took
it: USDC from Bitstamp USDC/USD's hourly OHLC (an hour with no volume has no row), USDT from Coinbase USDT-USD's hourly
candles. Also Kraken's EURC/EUR prints, reduced to the hour's last print, as a check on EURC's peg (the rule takes EURC at
1 EUR and TGBP at 1 GBP; review §3).
usage: python3 -I pull_usd.py RAW_DIR   -> RAW_DIR/usd/*.json (each body kept, with its sha256)
"""
import datetime, hashlib, json, os, sys, time, urllib.request

UA = {"User-Agent": "daviesportfolios-research/1.0 (public market data)"}
A = int(datetime.datetime(2025, 9, 1, tzinfo=datetime.timezone.utc).timestamp())
Z = int(datetime.datetime(2026, 10, 27, tzinfo=datetime.timezone.utc).timestamp())


def get(u):
    for a in range(8):
        try:
            b = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read()
            return b
        except Exception:  # noqa: BLE001
            time.sleep(2 + 3 * a)
    raise SystemExit("failed " + u)


def main(raw):
    d = os.path.join(raw, "usd"); os.makedirs(d, exist_ok=True)
    log = {}
    # Bitstamp USDC/USD hourly
    pages, s = [], A
    while s < Z:
        u = f"https://www.bitstamp.net/api/v2/ohlc/usdcusd/?step=3600&limit=1000&start={s}"
        b = get(u); pages.append({"url": u, "sha256": hashlib.sha256(b).hexdigest(), "body": json.loads(b)})
        s += 1000 * 3600
        time.sleep(0.5)
    json.dump(pages, open(os.path.join(d, "bitstamp_usdcusd_3600.json"), "w"))
    # Coinbase USDT-USD hourly (300 a request)
    pages, s = [], A
    while s < Z:
        e = min(Z, s + 300 * 3600)
        iso = lambda t: datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        u = f"https://api.exchange.coinbase.com/products/USDT-USD/candles?granularity=3600&start={iso(s)}&end={iso(e - 1)}"
        b = get(u); pages.append({"url": u, "sha256": hashlib.sha256(b).hexdigest(), "body": json.loads(b)})
        s = e
        time.sleep(0.4)
    json.dump(pages, open(os.path.join(d, "coinbase_usdtusd_3600.json"), "w"))
    # Kraken EURC/EUR prints -> hour's last print (since, in ns)
    hours, since, n = {}, A * 10**9, 0
    while True:
        u = f"https://api.kraken.com/0/public/Trades?pair=EURCEUR&since={since}&count=1000"
        j = json.loads(get(u))
        if j.get("error"):
            time.sleep(5); continue
        rows = next(v for k, v in j["result"].items() if k != "last")
        for r in rows:
            t = float(r[2])
            if t >= Z:
                break
            hours[int(t // 3600 * 3600)] = float(r[0])
        n += len(rows)
        last = int(j["result"]["last"])
        if not rows or last == since or float(rows[-1][2]) >= Z:
            break
        since = last
        time.sleep(1.1)
    json.dump({"source": "Kraken EURC/EUR public Trades, the hour's last print", "prints": n, "hours": hours},
              open(os.path.join(d, "kraken_eurceur_hours.json"), "w"))
    print("done", n, "kraken prints", len(hours), "hours")


if __name__ == "__main__":
    main(sys.argv[1])
