"""PR5v's fresh, keyless inputs after the committed PR5 tape: 2026-09-22 00:00 -> 2026-09-28 00:00 UTC (the latest
complete UTC day before the study began), as a second out-of-sample check.

* UK prints of USDC-GBP and USDT-GBP, day by day (bounds inclusive, so each day is [a, a + 1 day - 1 ms]):
  GET https://revx.revolut.com/api/1.0/public/trades/all?symbol=SYM&start_date=<ms>&end_date=<ms>&limit=100&region=UK[&cursor=]
  every page followed to an empty cursor, de-duplicated by id, UK rows only. 2026-09-22 overlaps the committed tape and
  is used only to check that the two pulls agree.
* The USD books' UK hourly candles, 2026-09-20 00:00 -> 2026-09-28 00:00 (fairU needs the 24 hours before a minute):
  GET https://revx.revolut.com/api/1.0/public/candles/{USDC-USD|USDT-USD}?interval=60&since=<ms>&until=<ms>&region=UK
* Yahoo's GBPUSD=X one-minute closes, the paper engine's own source (Exness publishes September on 1 October):
  GET https://query1.finance.yahoo.com/v8/finance/chart/GBPUSD=X?interval=1m&range=7d

One Revolut X request every 1.1 s. Everything is written gzipped with mtime 0 and sorted keys, so the same rows give the
same bytes; SHA256SUMS lists each file.
usage: pull_fresh.py OUT_DIR
"""
import datetime, gzip, hashlib, io, json, os, sys, time, urllib.parse, urllib.request, urllib.error

DAY = 86400000
BOOKS = ["USDC-GBP", "USDT-GBP"]
USD = ["USDC-USD", "USDT-USD"]
P0, P1 = "2026-09-22", "2026-09-28"
C0, C1 = "2026-09-20", "2026-09-28"
UA = {"Accept": "application/json", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) daviesportfolios-research/1.0"}


def ms(day):
    return int(datetime.datetime.fromisoformat(day + "T00:00").replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


_last = [0.0]


def get_json(url, revx=True):
    if revx:
        wait = _last[0] + 1.1 - time.time()
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                ra = e.headers.get("Retry-After")
                time.sleep(max(2.0, (float(ra) / 1000.0) if ra else 2.0))
            elif e.code < 500:
                return e.code, None
            else:
                time.sleep(2 ** (attempt + 1))
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2 ** (attempt + 1))
        _last[0] = time.time()
    raise SystemExit(f"gave up on {url}")


def dump_gz(obj, path):
    raw = json.dumps(obj, sort_keys=True, indent=0).encode()
    buf = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buf, mtime=0) as g:
        g.write(raw)
    open(path, "wb").write(buf.getvalue())
    return hashlib.sha256(buf.getvalue()).hexdigest()


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    sums = {}
    log = []
    # ---- prints
    for sym in BOOKS:
        rows = {}
        for a in range(ms(P0), ms(P1), DAY):
            b = a + DAY - 1
            cursor, page = "", 0
            while True:
                url = (f"https://revx.revolut.com/api/1.0/public/trades/all?symbol={sym}&start_date={a}&end_date={b}"
                       f"&limit=100&region=UK" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else ""))
                st, d = get_json(url)
                data = (d or {}).get("data") or []
                log.append({"url": url, "status": st, "n": len(data)})
                if st != 200:
                    raise SystemExit(f"{url} -> {st}")
                for r in data:
                    if r.get("region") != "UK":
                        continue
                    rows[r["id"]] = {"id": r["id"], "price": r["price"], "qty": r["quantity"], "region": r["region"],
                                     "side": r["side"], "ts": int(r["timestamp"])}
                cursor = ((d or {}).get("metadata") or {}).get("next_cursor") or ""
                page += 1
                if not cursor or page > 200:
                    break
        lst = sorted(rows.values(), key=lambda z: (z["ts"], z["id"]))
        sums[f"prints_{sym}.json.gz"] = dump_gz({"symbol": sym, "from": P0, "to": P1, "rows": lst}, os.path.join(out, f"prints_{sym}.json.gz"))
        print(sym, "prints", len(lst), flush=True)
    # ---- USD hourly candles
    for sym in USD:
        url = f"https://revx.revolut.com/api/1.0/public/candles/{sym}?interval=60&since={ms(C0)}&until={ms(C1)}&region=UK"
        st, d = get_json(url)
        data = (d or {}).get("data") or []
        log.append({"url": url, "status": st, "n": len(data)})
        rows = {int(r["start"]): r for r in data}
        sums[f"candles_{sym}_60.json.gz"] = dump_gz({"symbol": sym, "interval": 60, "region": "UK", "calls": [log[-1]],
                                                     "rows": [rows[k] for k in sorted(rows)]}, os.path.join(out, f"candles_{sym}_60.json.gz"))
        print(sym, "hours", len(rows), flush=True)
    # ---- Yahoo GBP/USD minutes
    url = "https://query1.finance.yahoo.com/v8/finance/chart/GBPUSD=X?interval=1m&range=7d"
    st, d = get_json(url, revx=False)
    log.append({"url": url, "status": st, "t_pulled_ms": int(time.time() * 1000)})
    if st != 200:
        raise SystemExit(f"yahoo -> {st}")
    sums["yahoo_GBPUSD_1m_7d.json.gz"] = dump_gz(d, os.path.join(out, "yahoo_GBPUSD_1m_7d.json.gz"))
    r = d["chart"]["result"][0]
    print("yahoo bars", len(r.get("timestamp") or []), flush=True)
    sums["_requests.json.gz"] = dump_gz(log, os.path.join(out, "_requests.json.gz"))
    with open(os.path.join(out, "SHA256SUMS"), "w") as f:
        for k in sorted(sums):
            f.write(f"{sums[k]}  {k}\n")


if __name__ == "__main__":
    main()
