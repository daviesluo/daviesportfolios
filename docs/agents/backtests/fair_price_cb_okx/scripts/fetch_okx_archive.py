"""OKX's keyless daily trade archive for one book (https://static.okx.com/cdn/okex/traderecords/trades/daily/<YYYYMMDD>/
<INST>-trades-<YYYY-MM-DD>.zip, the public "historical market data" download, as SCQ-VENUES' pull_okx.py read it), every print
kept: trade id, time (ms), price, size, the taker's side (the aggressor). Archive days are not UTC days, so prints are de-duplicated
by trade id. Writes {"source", "inst", "from", "to", "files": {day: [status, bytes, sha256]}, "prints": [[id, ms, price, size,
"b"|"s"], ...]} gzipped; the zips are not kept.
usage: python3 -I fetch_okx_archive.py INST FROM_DAY TO_DAY OUT.json.gz
"""
import csv, datetime, gzip, hashlib, io, json, sys, time, urllib.error, urllib.request, zipfile

inst, a, z, out = sys.argv[1], datetime.date.fromisoformat(sys.argv[2]), datetime.date.fromisoformat(sys.argv[3]), sys.argv[4]


def get(url):
    for k in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "daviesportfolios-research/1.0"}), timeout=120) as f:
                return 200, f.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return e.code, b""
            time.sleep(3 * (k + 1))
        except Exception:  # noqa: BLE001
            time.sleep(3 * (k + 1))
    return -1, b""


rows, files = {}, {}
day = a
while day <= z:
    st, body = get(f"https://static.okx.com/cdn/okex/traderecords/trades/daily/{day:%Y%m%d}/{inst}-trades-{day.isoformat()}.zip")
    files[day.isoformat()] = [st, len(body), hashlib.sha256(body).hexdigest() if body else None]
    if st == 200 and body:
        zf = zipfile.ZipFile(io.BytesIO(body))
        for name in zf.namelist():
            for r in csv.DictReader(io.StringIO(zf.read(name).decode())):
                if r["instrument_name"] != inst:
                    continue
                rows[int(r["trade_id"])] = [int(r["trade_id"]), int(r["created_time"]), r["price"], r["size"], "b" if r["side"] == "buy" else "s"]
    day += datetime.timedelta(days=1)
    time.sleep(0.2)
res = {"source": "static.okx.com/cdn/okex/traderecords/trades/daily", "inst": inst, "from": a.isoformat(), "to": z.isoformat(),
       "files": files, "prints": [rows[k] for k in sorted(rows)]}
with gzip.open(out, "wt") as f:
    json.dump(res, f, separators=(",", ":"))
print(len(res["prints"]), "prints;", sum(1 for v in files.values() if v[0] == 200), "files of", len(files))
