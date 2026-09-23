"""Fetch Binance spot klines from the public bulk archive (data.binance.vision).
usage: fetch_archive.py JOBFILE INTERVAL OUTDIR [threads]
JOBFILE: JSON {symbol: [YYYY-MM or YYYY-MM-DD, ...]} (a month -> monthly zip, a day -> daily zip).
Months not yet published (the current month) fall back to daily zips of that month.
Zips are kept under OUTDIR/zips/ (their sha256 go in the manifest); parsed rows go to
OUTDIR/<SYMBOL>.json as [[t_ms, o, h, l, c, base_vol, quote_vol, n_trades, taker_buy_base], ...] sorted,
timestamps normalised to ms (the archive switched to microseconds on 2025-01-01)."""
import sys, os, json, io, csv, zipfile, time, datetime, urllib.request, urllib.error, threading, queue, calendar
UA = {"User-Agent": "daviesportfolios-research/1.0 (public market data)"}
jobs = json.load(open(sys.argv[1])); iv = sys.argv[2]; out = sys.argv[3]
th = int(sys.argv[4]) if len(sys.argv) > 4 else 6
zdir = os.path.join(out, "zips"); os.makedirs(zdir, exist_ok=True)
today = datetime.datetime.utcnow().date()
def fetch(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return open(dest, "rb").read()
    if os.path.exists(dest + ".404"):
        return None
    for a in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as f:
                b = f.read()
            open(dest, "wb").write(b); return b
        except urllib.error.HTTPError as e:
            if e.code == 404:
                open(dest + ".404", "w").close(); return None
            time.sleep(2 * (a + 1))
        except Exception:
            time.sleep(2 * (a + 1))
    return None
def parse(b):
    rows = []
    z = zipfile.ZipFile(io.BytesIO(b))
    for name in z.namelist():
        for r in csv.reader(io.TextIOWrapper(z.open(name))):
            if not r or not r[0].isdigit(): continue
            t = int(r[0])
            if t > 10**14: t //= 1000
            rows.append([t, float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]), float(r[7]), int(r[8]), float(r[9])])
    return rows
tasks = []
for sym, periods in jobs.items():
    for p in periods:
        if len(p) == 7:
            y, m = int(p[:4]), int(p[5:7])
            last = datetime.date(y, m, calendar.monthrange(y, m)[1])
            if last >= today.replace(day=1) - datetime.timedelta(days=1) and (y, m) == (today.year, today.month):
                for dd in range(1, today.day):
                    tasks.append((sym, f"{p}-{dd:02d}"))
            else:
                tasks.append((sym, p))
        else:
            tasks.append((sym, p))
q = queue.Queue()
for t in tasks: q.put(t)
res = {}; lock = threading.Lock(); done = [0]
def worker():
    while True:
        try: sym, p = q.get_nowait()
        except queue.Empty: return
        if len(p) == 7:
            name = f"{sym}-{iv}-{p}.zip"; url = f"https://data.binance.vision/data/spot/monthly/klines/{sym}/{iv}/{name}"
        else:
            name = f"{sym}-{iv}-{p}.zip"; url = f"https://data.binance.vision/data/spot/daily/klines/{sym}/{iv}/{name}"
        b = fetch(url, os.path.join(zdir, name))
        rows = parse(b) if b else []
        with lock:
            res.setdefault(sym, []).extend(rows); done[0] += 1
            if done[0] % 200 == 0: print("done", done[0], "of", len(tasks), flush=True)
ts = [threading.Thread(target=worker) for _ in range(th)]
for t in ts: t.start()
for t in ts: t.join()
for sym, rows in res.items():
    m = {r[0]: r for r in rows}
    prev = []
    fn = os.path.join(out, f"{sym}.json")
    if os.path.exists(fn):
        for r in json.load(open(fn)): m.setdefault(r[0], r)
    json.dump([m[k] for k in sorted(m)], open(fn, "w"))
print("finished", len(tasks), "tasks", len(res), "symbols", flush=True)
