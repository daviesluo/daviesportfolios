# UK book's daily USD volume from Revolut X's public daily candles (keyless, region=UK): volume (base) x close, per day,
# last 30 closed UTC days (2026-08-31 .. 2026-09-29). One request per coin, ~1.3 s apart (the public bucket is ~1 token/s).
import json, time, urllib.request, statistics as st, datetime as dt
COINS = ["BTC","ETH","SOL","AVAX","SUI","XRP","LINK","DOGE","NEAR","HBAR","AAVE","CRV","INJ","ONDO","QNT","BERA","VIRTUAL","LTC","UNI","ADA"]
until = int(dt.datetime(2026, 9, 30, tzinfo=dt.timezone.utc).timestamp() * 1000)
since = until - 30 * 86400000
out = {}
for c in COINS:
    url = f"https://revx.revolut.com/api/1.0/public/candles/{c}-USD?interval=1440&since={since}&until={until}&region=UK"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "research-script"}), timeout=30) as r:
            d = json.loads(r.read())["data"]
    except Exception as e:
        out[c] = {"error": str(e)[:120]}; time.sleep(2); continue
    days = [x for x in d if since <= int(x["start"]) < until]
    usd = [float(x["volume"]) * float(x["close"]) for x in days]
    out[c] = {"days": len(days), "medianUsd": round(st.median(usd)) if usd else None, "minUsd": round(min(usd)) if usd else None,
              "daysUnder100k": sum(1 for u in usd if u < 100e3), "first": days[0]["start"] if days else None}
    time.sleep(1.3)
json.dump(out, open(__import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)), "..", "inputs", "daily_volume_30d.json"), "w"), indent=1)
for c, v in out.items(): print(c, v)
