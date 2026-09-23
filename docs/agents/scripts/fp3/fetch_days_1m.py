"""Fetch Binance spot 1m klines for given days per symbol (daily zips of data.binance.vision),
one symbol at a time (memory-light). usage: fetch_days_1m.py JOBFILE OUTDIR [threads]
JOBFILE {symbol: [YYYY-MM-DD, ...]}. Zips kept in OUTDIR/zips (404s marked). Output
OUTDIR/<SYM>.json rows [t_ms, o, h, l, c, base_vol] sorted (timestamps normalised to ms)."""
import sys, os, io, csv, json, zipfile, time, urllib.request, urllib.error, concurrent.futures
UA = {"User-Agent": "daviesportfolios-research/1.0 (public market data)"}
jobs = json.load(open(sys.argv[1])); out = sys.argv[2]; th = int(sys.argv[3]) if len(sys.argv) > 3 else 6
Z = os.path.join(out, "zips"); os.makedirs(Z, exist_ok=True)
def fetch(sym, day):
    name = f"{sym}-1m-{day}.zip"; dest = os.path.join(Z, name)
    if os.path.exists(dest) and os.path.getsize(dest) > 0: return open(dest, "rb").read()
    if os.path.exists(dest + ".404"): return None
    url = f"https://data.binance.vision/data/spot/daily/klines/{sym}/1m/{name}"
    for a in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as f: b = f.read()
            open(dest, "wb").write(b); return b
        except urllib.error.HTTPError as e:
            if e.code == 404: open(dest + ".404", "w").close(); return None
            time.sleep(2 * (a + 1))
        except Exception: time.sleep(2 * (a + 1))
    return None
def parse(b):
    rows = []
    zf = zipfile.ZipFile(io.BytesIO(b))
    for nm in zf.namelist():
        for r in csv.reader(io.TextIOWrapper(zf.open(nm))):
            if not r or not r[0].isdigit(): continue
            t = int(r[0])
            if t > 10**14: t //= 1000
            rows.append([t, float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])])
    return rows
tot = 0; missing = 0
with concurrent.futures.ThreadPoolExecutor(th) as ex:
    for sym, days in sorted(jobs.items()):
        fn = os.path.join(out, f"{sym}.json")
        if os.path.exists(fn): continue
        rows = {}
        for b in ex.map(lambda d: fetch(sym, d), days):
            if b is None: missing += 1; continue
            for r in parse(b): rows[r[0]] = r
        json.dump([rows[k] for k in sorted(rows)], open(fn, "w"), separators=(",", ":"))
        tot += len(days)
        print(sym, len(days), "days", len(rows), "rows", flush=True)
print("finished files", tot, "missing", missing, flush=True)
