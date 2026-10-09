"""Completeness of the committed CoinJar prints, checked against the venue again: for 12 days drawn with
random.Random(20261009) per book, page `after=<day start>` and compare every print of the page that falls before the cut
with the committed record (by tid, and field for field). The pull's own protocol (ascending pages, inclusive `after`,
no second fuller than a page, segments joined by tid) makes the record complete by construction; this reads it back.
usage: python3 -I spot_check.py   -> ../results/spot_check.json
"""
import json, os, random, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import inputs as I  # noqa: E402
from netget import get  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = {}
for p in I.PRODUCTS:
    rec = {x[0]: x for x in I.load_prints_full(p)}
    rng = random.Random(20261009)
    days = sorted(rng.randrange(I.START_MS[p] // 86400000, I.END_MS // 86400000) for _ in range(12))
    out = []
    for d in days:
        st, body = get(f"https://data.exchange.coinjar.com/products/{p}/trades?after={d * 86400}&limit=1000")
        time.sleep(1.0)
        rows = [r for r in json.loads(body) if r["timestamp"] < "2026-10-09"]
        missing = [r["tid"] for r in rows if r["tid"] not in rec]
        differ = 0
        for r in rows:
            x = rec.get(r["tid"])
            if x and (round(float(r["size"]) * 1e6) / 1e6 != x[3] or r["taker_side"] != x[5]
                      or abs(float(r["price"]) / 1e-4 - x[2]) > 1e-6):
                differ += 1
        out.append({"day": time.strftime("%Y-%m-%d", time.gmtime(d * 86400)), "http": st, "prints": len(rows), "missing": len(missing), "differ": differ})
    R[p] = out
    print(p, out)
R["all_present"] = all(o["missing"] == 0 and o["differ"] == 0 for p in I.PRODUCTS for o in R[p])
json.dump(R, open(os.path.join(HERE, "results", "spot_check.json"), "w"), indent=1, sort_keys=True)
print("all present:", R["all_present"])
