"""Interbank GBP/USD at minute resolution for CJ5's span (2020-04-01 -> 2026-10-09), keyless.

* EXN (the primary, PR5's frozen choice, `scripts/pr5/fx_build.py`): Exness's public monthly tick archive
  https://ticks.ex2archive.com/ticks/GBPUSD/<YYYY>/<MM>/Exness_GBPUSD_<YYYY>_<MM>.zip — bid/ask quotes with ms times.
  A minute's value is the mid of its last quote (the minute's close), as fx_build.py's `exness_minutes`. Each zip is
  reduced to RAW/exness/GBPUSD_<YYYY>_<MM>.minutes.json and deleted (8–10 MB a month); its sha256 and size are logged in
  RAW/exness/_log.json.
* YAHOO_1M: Yahoo's GBPUSD=X 1-minute closes (the live PR5 loop's source) for 2026-09-10 -> 2026-10-09, in 7-day
  chunks: it fills October 2026, which Exness has not published yet, and overlaps September as a check.
* YAHOO_1H: Yahoo's GBPUSD=X hourly, range=2y, the brief's independent cross-check (as pull_fx.py of PR5).
* FXCM: FXCM's weekly 1-minute bid/ask archive for one week a quarter, a second cross-check of EXN in each year.
usage: python3 -I pull_fx.py RAW_DIR exness|yahoo|fxcm
"""
import csv, datetime, glob, gzip, hashlib, io, json, os, sys, time, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from netget import get

M = 60000


def months():
    y, m = 2020, 4
    while (y, m) <= (2026, 9):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def exness(raw):
    d = os.path.join(raw, "exness"); os.makedirs(d, exist_ok=True)
    logf = os.path.join(d, "_log.json")
    log = json.load(open(logf)) if os.path.exists(logf) else {}
    for y, m in months():
        key = f"{y}_{m:02d}"
        out = os.path.join(d, f"GBPUSD_{key}.minutes.json")
        if os.path.exists(out) and key in log:
            continue
        st, body = get(f"https://ticks.ex2archive.com/ticks/GBPUSD/{y}/{m:02d}/Exness_GBPUSD_{key}.zip", timeout=300)
        if st != 200:
            raise SystemExit(f"exness {key}: HTTP {st}")
        z = zipfile.ZipFile(io.BytesIO(body))
        mins = {}
        with z.open(z.namelist()[0]) as f:
            next(f)
            for line in f:
                parts = line.decode().rstrip("\r\n").split(",")
                ts = parts[2].strip('"')
                t = datetime.datetime.strptime(ts[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=datetime.timezone.utc)
                mins[int(t.timestamp()) * 1000 // M * M] = (float(parts[3]) + float(parts[4])) / 2
        json.dump(sorted(mins.items()), open(out, "w"))
        log[key] = {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(), "member": z.namelist()[0], "minutes": len(mins)}
        json.dump(log, open(logf, "w"), indent=1, sort_keys=True)
        print("exness", key, len(body), len(mins), flush=True)
        time.sleep(2)


def yahoo(raw):
    d = os.path.join(raw, "yahoo"); os.makedirs(d, exist_ok=True)
    a = int(datetime.datetime(2026, 9, 10, tzinfo=datetime.timezone.utc).timestamp())
    z = int(datetime.datetime(2026, 10, 9, tzinfo=datetime.timezone.utc).timestamp())
    for s in range(a, z, 7 * 86400):
        e = min(z, s + 7 * 86400)
        st, body = get(f"https://query1.finance.yahoo.com/v8/finance/chart/GBPUSD=X?interval=1m&period1={s}&period2={e}", ua="Mozilla/5.0")
        print("yahoo 1m", s, st, len(body), flush=True)
        if st != 200:
            raise SystemExit(f"yahoo 1m {s}: HTTP {st}")
        open(os.path.join(d, f"GBPUSD_1m_{s}.json"), "wb").write(body)
        time.sleep(2)
    st, body = get("https://query1.finance.yahoo.com/v8/finance/chart/GBPUSD=X?interval=1h&range=2y", ua="Mozilla/5.0")
    print("yahoo 1h", st, len(body))
    open(os.path.join(d, "GBPUSD_1h_2y.json"), "wb").write(body)


def fxcm(raw):
    d = os.path.join(raw, "fxcm"); os.makedirs(d, exist_ok=True)
    log = []
    for y in range(2020, 2027):
        for w in (6, 19, 32, 45):
            if (y, w) < (2020, 19) or (y, w) > (2026, 17):
                continue
            fn = os.path.join(d, f"GBPUSD_{y}_{w:02d}.csv.gz")
            if not os.path.exists(fn):
                st, body = get(f"https://candledata.fxcorporate.com/m1/GBPUSD/{y}/{w}.csv.gz")
                log.append({"year": y, "week": w, "status": st, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()})
                print("fxcm", y, w, st, len(body), flush=True)
                if st == 200:
                    open(fn, "wb").write(body)
                time.sleep(1)
    json.dump(log, open(os.path.join(d, "_log.json"), "w"), indent=1)


if __name__ == "__main__":
    {"exness": exness, "yahoo": yahoo, "fxcm": fxcm}[sys.argv[2]](sys.argv[1])
