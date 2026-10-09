"""The crypto Up-or-Down series on Gamma with their 24 h volume and recurrence (keyless). Usage: pull_series.py out.json"""
import json, sys, urllib.request
A = ["btc", "eth", "sol", "xrp", "doge", "bnb", "hype", "zec"]; R = ["5m", "15m", "hourly", "4h", "daily"]
out = []
for a in A:
    for r in R:
        slug = f"{a}-up-or-down-{r}"
        d = json.load(urllib.request.urlopen(urllib.request.Request(f"https://gamma-api.polymarket.com/series?slug={slug}", headers={"User-Agent": "Mozilla/5.0 research"}), timeout=20))
        for s in d:
            out.append({"slug": s["slug"], "recurrence": s.get("recurrence"), "volume24hr": round(s.get("volume24hr") or 0), "active": s.get("active"), "closed": s.get("closed")})
out.sort(key=lambda x: -x["volume24hr"])
json.dump({"series": out, "total_volume24hr": sum(x["volume24hr"] for x in out)}, open(sys.argv[1], "w"), indent=1, sort_keys=True)
for x in out: print(x)
