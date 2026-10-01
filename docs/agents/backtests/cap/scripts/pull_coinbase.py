# Keyless pull of Coinbase Exchange hourly candles, the house backtester's source (backtest.ts header),
# into {SYM}-USD_1h_3y.json as [t_sec, o, h, l, c, v] ascending. Public GETs only.
import json, time, urllib.request, datetime as dt, sys, os, gzip
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "inputs")
START = dt.datetime(2023, 9, 20, tzinfo=dt.timezone.utc)
END = dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc)
def get(url):
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "research-script"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:
            time.sleep(1.5 * (k + 1))
    raise RuntimeError("failed " + url)
for sym in sys.argv[1:]:
    rows = {}
    t = START
    while t < END:
        e = min(t + dt.timedelta(hours=300), END)
        url = f"https://api.exchange.coinbase.com/products/{sym}-USD/candles?granularity=3600&start={t.strftime('%Y-%m-%dT%H:%M:%SZ')}&end={e.strftime('%Y-%m-%dT%H:%M:%SZ')}"
        for c in get(url):
            rows[int(c[0])] = [int(c[0]), float(c[3]), float(c[2]), float(c[1]), float(c[4]), float(c[5])]  # [time, low, high, open, close, volume] -> [t,o,h,l,c,v]
        t = e
        time.sleep(0.25)
    out = [rows[k] for k in sorted(rows)]
    with gzip.GzipFile(os.path.join(OUT, f"{sym}-USD_1h_3y.json.gz"), "wb", mtime=0) as g:
        g.write(json.dumps(out).encode())
    print(sym, len(out), dt.datetime.utcfromtimestamp(out[0][0]), dt.datetime.utcfromtimestamp(out[-1][0]), flush=True)
