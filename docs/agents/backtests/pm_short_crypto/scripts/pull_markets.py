"""Every BTC 5-minute and 15-minute Up-or-Down market of a span, from Gamma (keyless): its start price ("priceToBeat"),
final price, outcome, volume, condition id and token ids. Usage: pull_markets.py <end_unix> <days> <out.json>"""
import json, sys, urllib.request, concurrent.futures as cf
END, DAYS, OUT = int(sys.argv[1]), float(sys.argv[2]), sys.argv[3]
def get(slug):
    req = urllib.request.Request(f"https://gamma-api.polymarket.com/events?slug={slug}", headers={"User-Agent": "Mozilla/5.0 research"})
    for _ in range(4):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                d = json.load(r)
            break
        except Exception:
            d = None
    if not d: return {"slug": slug, "missing": True}
    e = d[0]; m = e["markets"][0]
    md = e.get("eventMetadata") or {}
    op = json.loads(m.get("outcomePrices") or "[]")
    return {"slug": slug, "start": m.get("eventStartTime"), "end": m.get("endDate"), "cond": m.get("conditionId"),
            "tokens": dict(zip(json.loads(m["outcomes"]), json.loads(m["clobTokenIds"]))),
            "closed": m.get("closed"), "up_won": (op[0] == "1") if op and m.get("closed") else None,
            "priceToBeat": md.get("priceToBeat"), "finalPrice": md.get("finalPrice"),
            "volume": float(m.get("volume") or 0), "feeType": m.get("feeType"), "feeSchedule": m.get("feeSchedule"),
            "config": m.get("cryptoMarketConfigId"), "closedTime": m.get("closedTime"),
            "rewardsMinSize": m.get("rewardsMinSize"), "rewardsMaxSpread": m.get("rewardsMaxSpread"),
            "holdingRewardsEnabled": m.get("holdingRewardsEnabled")}
slugs = []
for dur, fmt in ((300, "btc-updown-5m-{}"), (900, "btc-updown-15m-{}")):
    last = END - END % dur - dur  # the last window that has ended by END
    n = int(DAYS * 86400 / dur)
    slugs += [fmt.format(last - i * dur) for i in range(n)]
with cf.ThreadPoolExecutor(8) as ex:
    rows = list(ex.map(get, slugs))
json.dump(sorted(rows, key=lambda r: r["slug"]), open(OUT, "w"), indent=0, sort_keys=True)
print(len(rows), sum(1 for r in rows if r.get("missing")), sum(1 for r in rows if r.get("up_won") is not None))
