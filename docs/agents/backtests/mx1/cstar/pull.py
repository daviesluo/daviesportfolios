# Pull 1-minute klines from Binance's public market-data host for a fixed 90-day window.
import json, sys, time, urllib.request, gzip
START = 1782864000000  # 2026-07-01T00:00:00Z
END   = 1790640000000  # 2026-09-29T00:00:00Z (exclusive); the analysis stops at 09-27 23:59
def get(url):
    for k in range(5):
        try:
            with urllib.request.urlopen(url, timeout=30) as r: return json.loads(r.read())
        except Exception as e:
            time.sleep(2 ** k)
    raise RuntimeError(url)
for sym in sys.argv[1:]:
    out, t = [], START
    while t < END:
        rows = get(f"https://data-api.binance.vision/api/v3/klines?symbol={sym}&interval=1m&startTime={t}&limit=1000")
        if not rows: break
        out += [[r[0], float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])] for r in rows if r[0] < END]
        t = rows[-1][0] + 60000
    with gzip.open(f"{sym}_1m.json.gz", "wt") as f: json.dump(out, f)
    print(sym, len(out), out[0][0], out[-1][0])
