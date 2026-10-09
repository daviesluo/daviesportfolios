"""Every taker print of each BTC 5m/15m market whose window starts in [lo, hi) (data-api /v2/trades?condition=, keyless).
Writes {slug: [[ts, outcome_index(0=Up), side, price, size], ...]}. Usage: pull_prints.py markets.json lo hi out.json.gz"""
import json, sys, gzip, urllib.request, urllib.parse, concurrent.futures as cf, datetime
M = json.load(open(sys.argv[1])); LO, HI = int(sys.argv[2]), int(sys.argv[3]); OUT = sys.argv[4]
def st(r): return int(r["slug"].rsplit("-", 1)[1])
def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 research"})
    for i in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r: return json.load(r)
        except Exception as e:
            err = e
    raise err
def prints(m):
    rows, cursor = [], None
    for _ in range(100):
        q = {"condition": m["cond"], "limit": 1000}
        if cursor: q["cursor"] = cursor
        d = get("https://data-api.polymarket.com/v2/trades?" + urllib.parse.urlencode(q))
        data = d.get("data") or []
        rows += [[r["timestamp"], r["outcome_index"], r["side"], round(float(r["price"]), 6), round(float(r["size"]), 6)] for r in data]
        cursor = (d.get("pagination") or {}).get("next_cursor")
        if not cursor or not data: break
    return m["slug"], sorted(rows)
sel = [m for m in M if LO <= st(m) < HI]
with cf.ThreadPoolExecutor(8) as ex:
    out = dict(ex.map(prints, sel))
with gzip.open(OUT, "wt") as f: json.dump(out, f, separators=(",", ":"), sort_keys=True)
print(len(sel), sum(len(v) for v in out.values()))
