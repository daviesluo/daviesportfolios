# The UK book's daily USD volume, 30-day median, from Revolut X's public daily candles (keyless, region=UK).
# Revolut X's UK daily candles start at UK midnight (23:00 UTC in summer time), not UTC midnight, and the newest one is the
# FORMING day: only candles that have closed (start + 1 day <= now) are kept, the last 30 of them. Prints only.
import json, time, urllib.request, statistics as st, datetime as dt
DAY = 86400000
now = int(time.time() * 1000)
for c in ["BTC", "ETH", "SOL", "AVAX"]:
    url = f"https://revx.revolut.com/api/1.0/public/candles/{c}-USD?interval=1440&since={now - 40 * DAY}&until={now}&region=UK"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=30) as r:
        d = json.loads(r.read())["data"]
    days = sorted((x for x in d if int(x["start"]) + DAY <= now), key=lambda x: int(x["start"]))[-30:]
    usd = [float(x["volume"]) * float(x["close"]) for x in days]
    print(c, {"firstStartUtc": dt.datetime.fromtimestamp(int(days[0]["start"]) / 1000, dt.timezone.utc).isoformat(),
              "lastStartUtc": dt.datetime.fromtimestamp(int(days[-1]["start"]) / 1000, dt.timezone.utc).isoformat(), "days": len(days),
              "medianUsd": round(st.median(usd)), "minUsd": round(min(usd)), "daysUnder100k": sum(1 for u in usd if u < 100e3)})
    time.sleep(1.5)
