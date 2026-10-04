# Keyless read of Gamma's fee fields for the markets whose fills are studied (public data, GET only).
import json, sys, urllib.request, urllib.parse, time
conds = [c for c in open(sys.argv[1]).read().replace('\n', ',').split(',') if c.startswith('0x')]
out = {}
for closed in ("true", "false"):
    for i in range(0, len(conds), 50):
        q = [("limit", "100"), ("closed", closed)] + [("condition_ids", c) for c in conds[i:i+50]]
        url = "https://gamma-api.polymarket.com/markets/keyset?" + urllib.parse.urlencode(q)
        req = urllib.request.Request(url, headers={"User-Agent": "curl/8.5.0", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.load(r)
        for m in d.get("markets", []):
            out[m["conditionId"]] = {
                "feeType": m.get("feeType"), "feesEnabled": m.get("feesEnabled"), "feeSchedule": m.get("feeSchedule"),
                "question": (m.get("question") or "")[:90], "closed": m.get("closed"), "endDate": m.get("endDate"),
                "closedTime": m.get("closedTime"), "createdAt": m.get("createdAt"), "negRisk": m.get("negRisk"),
            }
        time.sleep(0.3)
json.dump(out, open(sys.argv[2], "w"), indent=1)
missing = [c for c in conds if c not in out]
print("conds", len(conds), "found", len(out), "missing", len(missing))
from collections import Counter
print(Counter((v["feeType"], json.dumps(v["feeSchedule"], sort_keys=True) if v["feeSchedule"] else None, v["feesEnabled"]) for v in out.values()).most_common())
