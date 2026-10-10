"""Interbank EUR/USD at minute resolution for 2024-09 -> 2026-10-09, keyless, the way CJ5 built GBP/USD
(`backtests/cj5/scripts/pull_fx.py`): EXN, Exness's public monthly tick archive
(https://ticks.ex2archive.com/ticks/EURUSD/<YYYY>/<MM>/Exness_EURUSD_<YYYY>_<MM>.zip), minute-close mid, to 2026-09-30;
then Yahoo's EURUSD=X 1-minute closes (2026-09-10 -> 10-09: October, which Exness has not published, and September as a
check). GBP/USD is CJ5's committed series, reused unchanged. Each zip is reduced to RAW/fx_eur/EURUSD_<YYYY>_<MM>.minutes.json
and deleted; its sha256 and size go to RAW/fx_eur/_log.json.
usage: python3 -I pull_fx_eur.py RAW_DIR
"""
import datetime, hashlib, io, json, os, sys, time, zipfile
sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../cj5/scripts")))
from netget import get  # noqa: E402  (CJ5's keyless GET)

M = 60000


def main(raw):
    d = os.path.join(raw, "fx_eur"); os.makedirs(d, exist_ok=True)
    logf = os.path.join(d, "_log.json")
    log = json.load(open(logf)) if os.path.exists(logf) else {}
    y, m = 2024, 9
    while (y, m) <= (2026, 9):
        key = f"{y}_{m:02d}"
        out = os.path.join(d, f"EURUSD_{key}.minutes.json")
        if not (os.path.exists(out) and key in log):
            st, body = get(f"https://ticks.ex2archive.com/ticks/EURUSD/{y}/{m:02d}/Exness_EURUSD_{key}.zip", timeout=300)
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
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    a = int(datetime.datetime(2026, 9, 10, tzinfo=datetime.timezone.utc).timestamp())
    z = int(datetime.datetime(2026, 10, 9, tzinfo=datetime.timezone.utc).timestamp())
    for s in range(a, z, 7 * 86400):
        e = min(z, s + 7 * 86400)
        st, body = get(f"https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?interval=1m&period1={s}&period2={e}", ua="Mozilla/5.0")
        print("yahoo 1m", s, st, len(body), flush=True)
        if st != 200:
            raise SystemExit(f"yahoo 1m {s}: HTTP {st}")
        open(os.path.join(d, f"EURUSD_1m_{s}.json"), "wb").write(body)
        time.sleep(2)


if __name__ == "__main__":
    main(sys.argv[1])
