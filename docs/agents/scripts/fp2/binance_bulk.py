"""Binance spot 1-minute klines from the public bulk archive (data.binance.vision),
monthly zips for whole months, daily zips for the current month, and the
data-api.binance.vision REST mirror for the part of today the archive lacks.

usage: binance_bulk.py SYMBOL[,SYMBOL...] START_YYYY-MM-DD END_YYYY-MM-DD(exclusive) [interval=1m]
Writes data/binance/<SYMBOL>_<interval>.json as [[t_ms, o, h, l, c, v, quote_v, n_trades], ...].
Timestamps in the archive switched to microseconds on 2025-01-01; both are normalised to ms.
"""
import io, json, os, sys, zipfile, datetime, csv, urllib.request, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import netlib

S = netlib.S
OUT = os.path.join(S, "data", os.environ.get("BN_OUT", "binance"))
os.makedirs(OUT, exist_ok=True)
RAW = os.path.join(OUT, "zips")
os.makedirs(RAW, exist_ok=True)

def fetch(url, dest):
    if os.path.exists(dest):
        return open(dest, "rb").read()
    for a in range(5):
        try:
            req = urllib.request.Request(url, headers=netlib.UA)
            with urllib.request.urlopen(req, timeout=120) as f:
                b = f.read()
            open(dest, "wb").write(b)
            return b
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 * (a + 1))
        except Exception:
            time.sleep(2 * (a + 1))
    return None

def parse_zip(b):
    rows = []
    z = zipfile.ZipFile(io.BytesIO(b))
    for name in z.namelist():
        for r in csv.reader(io.TextIOWrapper(z.open(name))):
            if not r or not r[0].isdigit():
                continue
            t = int(r[0])
            if t > 10**14:
                t //= 1000
            rows.append([t, float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]), float(r[7]), int(r[8])])
    return rows

def main():
    syms = sys.argv[1].split(",")
    d0 = datetime.date.fromisoformat(sys.argv[2])
    d1 = datetime.date.fromisoformat(sys.argv[3])
    iv = sys.argv[4] if len(sys.argv) > 4 else "1m"
    today = datetime.datetime.utcnow().date()
    for sym in syms:
        fn = os.path.join(OUT, f"{sym}_{iv}.json")
        rows = {}
        src = []
        d = d0
        while d < d1:
            month_end = (d.replace(day=28) + datetime.timedelta(days=4)).replace(day=1)
            if d.day == 1 and month_end <= d1 and month_end <= today.replace(day=1):
                name = f"{sym}-{iv}-{d.year}-{d.month:02d}.zip"
                b = fetch(f"https://data.binance.vision/data/spot/monthly/klines/{sym}/{iv}/{name}", os.path.join(RAW, name))
                if b:
                    for r in parse_zip(b):
                        rows[r[0]] = r
                    src.append(name)
                    d = month_end
                    continue
            name = f"{sym}-{iv}-{d.isoformat()}.zip"
            b = fetch(f"https://data.binance.vision/data/spot/daily/klines/{sym}/{iv}/{name}", os.path.join(RAW, name))
            if b:
                for r in parse_zip(b):
                    rows[r[0]] = r
                src.append(name)
            d += datetime.timedelta(days=1)
        # fill the tail from the REST mirror
        last = max(rows) if rows else int(datetime.datetime.combine(d0, datetime.time()).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
        end_ms = int(datetime.datetime.combine(d1, datetime.time()).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
        api_calls = 0
        while last + 60000 < end_ms:
            st, data, t0, t1 = netlib.get_json(f"https://data-api.binance.vision/api/v3/klines?symbol={sym}&interval={iv}&startTime={last + 1}&limit=1000")
            api_calls += 1
            if st != 200 or not data:
                break
            for k in data:
                r = [int(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5]), float(k[7]), int(k[8])]
                if r[0] < end_ms:
                    rows[r[0]] = r
            nl = int(data[-1][0])
            if nl <= last:
                break
            last = nl
            if len(data) < 1000:
                break
        out = [rows[t] for t in sorted(rows)]
        # drop the still-forming minute
        now_ms = int(time.time() * 1000)
        out = [r for r in out if r[0] + 60000 <= now_ms]
        json.dump(out, open(fn, "w"), separators=(",", ":"))
        with open(os.path.join(OUT, "provenance.jsonl"), "a") as f:
            f.write(json.dumps({"sym": sym, "interval": iv, "bars": len(out), "first": out and datetime.datetime.utcfromtimestamp(out[0][0] / 1000).isoformat(),
                                "last": out and datetime.datetime.utcfromtimestamp(out[-1][0] / 1000).isoformat(), "archive_files": len(src),
                                "api_calls": api_calls, "pulled_at": datetime.datetime.utcnow().isoformat() + "Z",
                                "source": "https://data.binance.vision/data/spot/{monthly,daily}/klines/ + https://data-api.binance.vision/api/v3/klines"}) + "\n")
        print(sym, len(out), flush=True)

if __name__ == "__main__":
    main()
