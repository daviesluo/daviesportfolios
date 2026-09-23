"""Fetch Binance spot aggTrades from the public bulk archive and aggregate them per minute.
usage: fetch_aggtrades.py SYMBOL FIRST_MONTH(YYYY-MM) LAST_DAY(YYYY-MM-DD, inclusive)
Monthly zips for whole months before LAST_DAY's month, daily zips for LAST_DAY's month.
Zips kept under data/aggtrades/zips/. Output data/aggtrades/<SYMBOL>_min.json:
{ "<minute_ms>": [last_price, [[price, quote_notional], ...]] } with the per-minute levels sorted
by price (notional = sum of price*qty of the prints at that price in that minute), and
data/aggtrades/<SYMBOL>_meta.json (files, rows, first/last print, duplicates removed)."""
import sys, os, io, csv, json, zipfile, datetime, urllib.request, urllib.error, time
UA = {"User-Agent": "daviesportfolios-research/1.0 (public market data)"}
S = os.environ.get("FP_ROOT", ".") + "/research_fp3"
OUT = os.path.join(S, "data", "aggtrades"); Z = os.path.join(OUT, "zips"); os.makedirs(Z, exist_ok=True)
sym, first, lastday = sys.argv[1], sys.argv[2], sys.argv[3]
ld = datetime.date.fromisoformat(lastday)
def fetch(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0: return open(dest, "rb").read()
    for a in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as f: b = f.read()
            open(dest, "wb").write(b); return b
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            time.sleep(2 * (a + 1))
        except Exception: time.sleep(2 * (a + 1))
    raise RuntimeError("failed " + url)
files = []
y, m = int(first[:4]), int(first[5:7])
while (y, m) < (ld.year, ld.month):
    files.append(("monthly", f"{y}-{m:02d}")); m += 1
    if m == 13: y, m = y + 1, 1
for dd in range(1, ld.day + 1): files.append(("daily", f"{ld.year}-{ld.month:02d}-{dd:02d}"))
mins = {}; maxid = -1; rows = 0; dups = 0; used = []; tmin = None; tmax = None
for kind, p in files:
    name = f"{sym}-aggTrades-{p}.zip"
    b = fetch(f"https://data.binance.vision/data/spot/{kind}/aggTrades/{sym}/{name}", os.path.join(Z, name))
    if b is None: continue
    used.append(name)
    zf = zipfile.ZipFile(io.BytesIO(b))
    for nm in zf.namelist():
        for r in csv.reader(io.TextIOWrapper(zf.open(nm))):
            if not r or not r[0].isdigit(): continue
            aid = int(r[0])
            if aid <= maxid: dups += 1; continue
            maxid = aid
            px = float(r[1]); q = float(r[2]); t = int(r[5])
            if t > 10**14: t //= 1000
            rows += 1
            mk = t - t % 60000
            e = mins.get(mk)
            if e is None: e = mins[mk] = [None, {}, -1]
            if t >= e[2]: e[0] = px; e[2] = t  # last print (ties: later id wins since ids increase)
            e[1][px] = e[1].get(px, 0.0) + px * q
            tmin = t if tmin is None or t < tmin else tmin; tmax = t if tmax is None or t > tmax else tmax
out = {str(k): [v[0], sorted([[p, round(n, 6)] for p, n in v[1].items()])] for k, v in sorted(mins.items())}
json.dump(out, open(os.path.join(OUT, f"{sym}_min.json"), "w"), separators=(",", ":"))
json.dump({"symbol": sym, "files": used, "prints": rows, "duplicates_removed": dups, "minutes_with_prints": len(out),
           "first": datetime.datetime.utcfromtimestamp(tmin/1000).isoformat() if tmin else None,
           "last": datetime.datetime.utcfromtimestamp(tmax/1000).isoformat() if tmax else None}, open(os.path.join(OUT, f"{sym}_meta.json"), "w"), indent=1)
print(sym, "files", len(used), "prints", rows, "dups", dups, "minutes", len(out), flush=True)
