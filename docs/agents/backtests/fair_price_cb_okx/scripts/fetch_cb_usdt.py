"""Coinbase Exchange's public USDT-USD one-minute candles (keyless), the coin's dollar price on the venue the paper rows quote.
Coinbase lists no USDC-USD book (USDC converts 1:1 with USD there), so USDT is the only coin whose Coinbase dollar price has to
be read. The paper engine never reads this: it is a candidate input of the fair-price study.

Each candle is [time (s), low, high, open, close, volume]; a minute with no trade has no candle. Paced at 4 requests a second
(Coinbase allows 10 per IP). Writes {"source", "from", "to", "candles": [[minute (epoch/60), close, volume], ...]} gzipped.
usage: python3 -I fetch_cb_usdt.py FROM_ISO TO_ISO OUT.json.gz
"""
import datetime, gzip, json, sys, time, urllib.request

frm, to, out = sys.argv[1], sys.argv[2], sys.argv[3]
p = lambda s: int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
a, z = p(frm), p(to)
rows = {}
t = a
while t < z:
    e = min(z, t + 300 * 60)
    url = ("https://api.exchange.coinbase.com/products/USDT-USD/candles?granularity=60&start="
           + datetime.datetime.utcfromtimestamp(t).strftime("%Y-%m-%dT%H:%M:%SZ") + "&end="
           + datetime.datetime.utcfromtimestamp(e - 60).strftime("%Y-%m-%dT%H:%M:%SZ"))
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "daviesportfolios-study"})
            body = json.loads(urllib.request.urlopen(req, timeout=20).read())
            break
        except Exception as ex:  # noqa: BLE001
            time.sleep(1 + attempt)
    else:
        raise SystemExit(f"failed {url}")
    for c in body:
        if a <= c[0] < z:
            rows[c[0] // 60] = [c[0] // 60, c[4], c[5]]
    t = e
    time.sleep(0.25)
res = {"source": "api.exchange.coinbase.com/products/USDT-USD/candles granularity=60", "from": frm, "to": to,
       "fetched": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
       "candles": [rows[k] for k in sorted(rows)]}
with gzip.open(out, "wt") as f:
    json.dump(res, f, separators=(",", ":"))
print(len(res["candles"]), "minutes")
