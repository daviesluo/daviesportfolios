"""Gamma's priceToBeat, finalPrice and outcome for every window the live recorder saw. Usage: pull_outcomes.py clob.jsonl out.json"""
import json, sys, urllib.request
slugs = sorted({json.loads(l)["m"] for l in open(sys.argv[1]) if '"k":"bk"' in l})
out = {}
for s in slugs:
    e = json.load(urllib.request.urlopen(urllib.request.Request(f"https://gamma-api.polymarket.com/events?slug={s}", headers={"User-Agent": "Mozilla/5.0 research"}), timeout=20))[0]
    m = e["markets"][0]; md = e.get("eventMetadata") or {}; op = json.loads(m.get("outcomePrices") or "[]")
    out[s] = {"priceToBeat": md.get("priceToBeat"), "finalPrice": md.get("finalPrice"), "volume": float(m.get("volume") or 0),
              "up_won": (op[0] == "1") if m.get("closed") and op else None}
json.dump(out, open(sys.argv[2], "w"), indent=1, sort_keys=True)
print(len(out), sum(1 for v in out.values() if v["up_won"] is not None))
