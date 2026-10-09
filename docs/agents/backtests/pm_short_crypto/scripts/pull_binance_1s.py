"""Binance BTCUSDT 1-second klines (keyless, data-api.binance.vision): {"t0": first second, "close": [...]} with a
close for every second (a second with no kline repeats the last close). Usage: pull_binance_1s.py lo hi out.json.gz"""
import json, sys, gzip, urllib.request, concurrent.futures as cf
LO, HI, OUT = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
def get(s):
    url = f"https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1s&startTime={s*1000}&endTime={(s+999)*1000}&limit=1000"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 research"})
    for _ in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r: return json.load(r)
        except Exception as e: err = e
    raise err
with cf.ThreadPoolExecutor(6) as ex:
    chunks = list(ex.map(get, range(LO, HI, 1000)))
px = {}
for c in chunks:
    for k in c: px[k[0] // 1000] = float(k[4])
close, last = [], None
for s in range(LO, HI):
    last = px.get(s, last); close.append(last)
with gzip.open(OUT, "wt") as f: json.dump({"t0": LO, "close": close, "missing": sum(1 for s in range(LO, HI) if s not in px)}, f, separators=(",", ":"))
print(len(close), sum(1 for s in range(LO, HI) if s not in px))
