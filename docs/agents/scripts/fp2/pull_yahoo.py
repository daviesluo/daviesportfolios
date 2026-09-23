"""Yahoo Finance chart API (keyless): hourly bars for the last 730 days.
Writes data/ref/yahoo_<SYM>_1h.json as [[t_ms, o, h, l, c, v], ...] + provenance line."""
import json, os, sys, time, urllib.request, datetime
S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def yahoo(sym, interval, extra):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval={interval}&{extra}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as f:
        d = json.load(f)
    r = d["chart"]["result"][0]
    ts = r.get("timestamp") or []
    q = r["indicators"]["quote"][0]
    rows = [[t * 1000, q["open"][i], q["high"][i], q["low"][i], q["close"][i], q.get("volume", [None]*len(ts))[i]] for i, t in enumerate(ts) if q["close"][i] is not None]
    return rows, url, r.get("meta", {})
for sym in sys.argv[1].split(","):
    rows, url, meta = yahoo(sym, "1h", "range=730d")
    fn = os.path.join(S, "data", "ref", f"yahoo_{sym.replace('=','_')}_1h.json")
    json.dump(rows, open(fn, "w"))
    with open(os.path.join(S, "data", "ref", "provenance.jsonl"), "a") as f:
        f.write(json.dumps({"file": os.path.basename(fn), "rows": len(rows), "url": url, "tz": meta.get("exchangeTimezoneName"), "at": datetime.datetime.utcnow().isoformat() + "Z"}) + "\n")
    print(sym, len(rows), datetime.datetime.utcfromtimestamp(rows[0][0]/1000), datetime.datetime.utcfromtimestamp(rows[-1][0]/1000))
    time.sleep(1)
