"""8-K item 2.02 acceptance times for twelve large caps: metadata only, no prices or returns read.
Classifies each filing by US Eastern time: before 09:30, 09:30-16:00, after 16:00. Output edgar_timing.json."""
import json, os, time, urllib.request, collections
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
HERE = os.path.dirname(os.path.abspath(__file__))
UA = os.environ["SEC_USER_AGENT"]  # SEC fair access: "<name> <contact email>", set by whoever runs it
CACHE = os.path.join(HERE, "..", "inputs", "edgar")  # fetched on first run, not committed
os.makedirs(CACHE, exist_ok=True)
if not os.path.exists(os.path.join(CACHE, "company_tickers.json")):
    open(os.path.join(CACHE, "company_tickers.json"), "wb").write(urllib.request.urlopen(urllib.request.Request("https://www.sec.gov/files/company_tickers.json", headers={"User-Agent": UA}), timeout=30).read())
tick = {v["ticker"]: v["cik_str"] for v in json.load(open(os.path.join(CACHE, "company_tickers.json"))).values()}
names = ["AAPL", "MSFT", "AMZN", "GOOGL", "META", "NVDA", "JPM", "JNJ", "XOM", "PG", "WMT", "UNH"]
ET = ZoneInfo("America/New_York")
out, buckets, lag_days = {}, collections.Counter(), collections.Counter()
for t in names:
    cik = f"{tick[t]:010d}"
    p = os.path.join(CACHE, f"CIK{cik}.json")
    if not os.path.exists(p):
        req = urllib.request.Request(f"https://data.sec.gov/submissions/CIK{cik}.json", headers={"User-Agent": UA})
        open(p, "wb").write(urllib.request.urlopen(req, timeout=30).read()); time.sleep(0.25)
    r = json.load(open(p))["filings"]["recent"]
    rows = []
    for i, f in enumerate(r["form"]):
        if f == "8-K" and "2.02" in r["items"][i]:
            acc = datetime.fromisoformat(r["acceptanceDateTime"][i].replace("Z", "+00:00")).astimezone(ET)
            m = acc.hour * 60 + acc.minute
            b = "pre_open" if m < 570 else ("regular" if m < 960 else "after_close")
            rows.append((r["filingDate"][i], acc.strftime("%H:%M ET"), b)); buckets[b] += 1
            if acc.date().isoformat() != r["filingDate"][i]:
                lag_days["filingDate != ET acceptance date"] += 1
    out[t] = {"n": len(rows), "first": rows[-1][0] if rows else None, "by_bucket": dict(collections.Counter(x[2] for x in rows)),
              "examples": rows[:2]}
out["_total_by_bucket"] = dict(buckets); out["_date_mismatch"] = dict(lag_days)
json.dump(out, open(os.path.join(HERE, "..", "results", "edgar_timing.json"), "w"), indent=1)
print(json.dumps(out, indent=1))
