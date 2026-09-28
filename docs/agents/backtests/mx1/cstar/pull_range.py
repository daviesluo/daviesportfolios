# Pull Binance 1-minute klines (public, keyless: data-api.binance.vision) for a fixed span, 1,000 minutes a request,
# a few requests in flight at once. Each request covers exactly [start, start + 1000 min) and keeps only rows inside it,
# so chunks never overlap; the result is de-duplicated by open time and written as {SYM}_1m_{from}_{to}.json.gz with
# rows [openTimeMs, open, high, low, close, volume] -- the same shape as the files pull.py wrote.
#   python3 pull_range.py 2023-08-21 2026-07-01 BTCUSDT ETHUSDT SOLUSDT
import concurrent.futures as cf, datetime as dt, gzip, json, sys, time, urllib.error, urllib.request

def ms(day): return int(dt.datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc).timestamp() * 1000)
FROM, TO = sys.argv[1], sys.argv[2]
START, END = ms(FROM), ms(TO)
STEP = 1000 * 60000
WORKERS = 6

def get(url):
    for k in range(8):
        try:
            with urllib.request.urlopen(url, timeout=40) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (418, 429):
                wait = int(e.headers.get("Retry-After") or 60)
                print(f"HTTP {e.code}, sleeping {wait}s", flush=True); time.sleep(wait)
            else:
                time.sleep(2 ** k)
        except Exception:
            time.sleep(2 ** k)
    raise RuntimeError(url)

def chunk(sym, t):
    rows = get(f"https://data-api.binance.vision/api/v3/klines?symbol={sym}&interval=1m&startTime={t}&limit=1000")
    return [[r[0], float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])] for r in rows if t <= r[0] < min(t + STEP, END)]

for sym in sys.argv[3:]:
    starts = list(range(START, END, STEP))
    out, done, t0 = {}, 0, time.time()
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(chunk, sym, t): t for t in starts}
        for f in cf.as_completed(futs):
            for r in f.result(): out[r[0]] = r
            done += 1
            if done % 100 == 0: print(f"{sym} {done}/{len(starts)} requests, {time.time() - t0:.0f}s", flush=True)
    rows = [out[k] for k in sorted(out)]
    gaps = sum(1 for a, b in zip(rows, rows[1:]) if b[0] - a[0] != 60000)
    missing = (END - START) // 60000 - len(rows)
    with gzip.open(f"{sym}_1m_{FROM}_{TO}.json.gz", "wt") as f: json.dump(rows, f)
    print(f"{sym}: {len(rows)} rows, {rows[0][0]} .. {rows[-1][0]}, gaps {gaps}, minutes missing {missing}, {len(starts)} requests", flush=True)
