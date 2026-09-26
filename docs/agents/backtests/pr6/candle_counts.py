"""Coverage of the UK hourly candles pulled for the completeness check: hours, hours with volume, volume. No prices read."""
import json, os, datetime, collections

D = os.environ.get("PR6_DATA")
for sym in ("USDC-USD", "USDT-USD"):
    by = {}
    fails = 0
    for l in open(os.path.join(D, "raw", f"{sym}.candles60.pages.jsonl")):
        p = json.loads(l)
        if p["status"] != 200 or p["data"] is None:
            fails += 1
            continue
        for c in p["data"]:
            by[int(c["start"])] = float(c["volume"])
    ks = sorted(by)
    first = datetime.datetime.fromtimestamp(ks[0] / 1000, datetime.timezone.utc).isoformat() if ks else None
    last = datetime.datetime.fromtimestamp(ks[-1] / 1000, datetime.timezone.utc).isoformat() if ks else None
    firstvol = next((k for k in ks if by[k] > 0), None)
    per_month = collections.Counter()
    for k in ks:
        per_month[datetime.datetime.fromtimestamp(k / 1000, datetime.timezone.utc).strftime("%Y-%m")] += by[k]
    print(sym, "failed pages", fails, "hours", len(ks), "first", first, "last", last,
          "hours with volume", sum(1 for k in ks if by[k] > 0),
          "first hour with volume", datetime.datetime.fromtimestamp(firstvol / 1000, datetime.timezone.utc).isoformat() if firstvol else None)
    print("  base volume by month:", {m: round(v) for m, v in sorted(per_month.items())})
