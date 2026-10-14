import json, math, re, statistics, urllib.request, urllib.parse
from collections import defaultdict
from datetime import date as ddate

def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "research-probe", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

# A. resolution texts for one daily touch market and one daily above market
for slug_q in ["Will Bitcoin reach $86,000 on October 13?", "Will the price of Bitcoin be above $86,000 on October 14?"]:
    d = get("https://gamma-api.polymarket.com/public-search?" + urllib.parse.urlencode({"q": slug_q, "limit_per_type": 5}))
    for ev in d.get("events", [])[:1]:
        for m in ev.get("markets", []):
            if m.get("question") == slug_q:
                print("Q:", m["question"])
                print("  endDate:", m.get("endDate"), "| resolutionSource:", m.get("resolutionSource"))
                desc = re.sub(r"\s+", " ", m.get("description") or "")
                print("  desc:", desc[:420])

# B. bucket distributions from the price-on events, all markets of the event
events = {}
for q in ["Bitcoin price on October", "Ethereum price on October"]:
    d = get("https://gamma-api.polymarket.com/public-search?" + urllib.parse.urlencode({"q": q, "limit_per_type": 30, "events_status": "active"}))
    for ev in d.get("events", []):
        events[ev["id"]] = ev
print("\nbucket events found:", len(events))

spot, vol = {}, {}
for asset, prod in (("BTC", "BTC-USD"), ("ETH", "ETH-USD")):
    t = get(f"https://api.exchange.coinbase.com/products/{prod}/ticker")
    spot[asset] = float(t["price"])
    c = get(f"https://api.exchange.coinbase.com/products/{prod}/candles?granularity=86400")
    closes = [row[4] for row in sorted(c, key=lambda x: x[0])][-31:]
    vol[asset] = statistics.pstdev([math.log(closes[i+1]/closes[i]) for i in range(len(closes)-1)]) * math.sqrt(365)

def ncdf(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
def parse_bounds(text):
    t = text.lower().replace(",", "").replace("$", "")
    m = re.search(r"less than\s*([0-9.]+)(k|m)?", t)
    if m: return (0.0, float(m.group(1)) * (1000 if m.group(2) == "k" else 1000000 if m.group(2) == "m" else 1))
    m = re.search(r"greater than\s*([0-9.]+)(k|m)?", t)
    if m: return (float(m.group(1)) * (1000 if m.group(2) == "k" else 1000000 if m.group(2) == "m" else 1), float("inf"))
    m = re.search(r"([0-9.]+)(k|m)?\s*[-–]\s*([0-9.]+)(k|m)?", t)
    if m:
        f = lambda v, s: v * (1000 if s == "k" else 1000000 if s == "m" else 1)
        return (f(float(m.group(1)), m.group(2)), f(float(m.group(3)), m.group(4)))
    return None

today = ddate(2026, 10, 14)
for ev in sorted(events.values(), key=lambda e: str(e.get("endDate")))[:14]:
    title = ev.get("title") or ""
    asset = "BTC" if "bitcoin" in title.lower() else "ETH" if "ethereum" in title.lower() else None
    if asset not in spot: continue
    try: horizon = max((ddate.fromisoformat(str(ev.get("endDate"))[:10]) - today).days, 0.5) / 365.0
    except Exception: continue
    S, sg = spot[asset], vol[asset]
    def cdf_at(x):
        if x <= 0: return 0.0
        if x == float("inf"): return 1.0
        return ncdf((math.log(x / S) + 0.5 * sg * sg * horizon) / (sg * math.sqrt(horizon)))
    devs, ssum, tail_m, tail_mod = [], 0.0, 0.0, 0.0
    for m in ev.get("markets", []):
        if m.get("closed"): continue
        b = parse_bounds((m.get("groupItemTitle") or "") + " " + (m.get("question") or ""))
        try:
            bid, ask = float(m.get("bestBid")), float(m.get("bestAsk"))
            mid = (bid + ask) / 2
        except Exception:
            continue
        if not b: continue
        model = cdf_at(b[1]) - cdf_at(b[0])
        devs.append((abs(mid - model), round(mid, 3), round(model, 3), b))
        ssum += mid
        if b[1] <= S * 0.93 or b[0] >= S * 1.07: tail_m += mid; tail_mod += model
    if len(devs) >= 5:
        devs.sort(reverse=True)
        print(asset, title[:40], "end", str(ev.get("endDate"))[:10], "buckets", len(devs), "sum_mids", round(ssum, 3),
              "tail(|x|>7%) mkt", round(tail_m, 3), "vs model", round(tail_mod, 3), "max_dev(mid,model,range)", devs[0])
