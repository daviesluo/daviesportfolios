"""PR5-W arm 3a's backward candles: Revolut X's keyless hourly UK candles of BTC, ETH, SOL and XRP against USD and
GBP, 2025-11-25 00:00 -> 2026-09-23 00:00 UTC (`reviews/2026-09-28-pr5-weekend-prereg.md`, "Arms" 3a). The venue drops
hourly candles after about a year, so they are pulled within seven days of the freeze and committed.

GET https://revx.revolut.com/api/1.0/public/candles/{SYM}?interval=60&since=<ms>&until=<ms>&region=UK
<= 1,000 candles a call, one call every 1.1 s. Each symbol is written as PR5's candles are
(`inputs/pr5_2026-09-23/candles/`): {"symbol", "interval", "region", "calls": [{url, status, n}], "rows": [candles,
unique by start, sorted]}, dumped with indent=0 and sorted keys, gzipped with no name and mtime 0 so that the same
rows give the same bytes; SHA256SUMS beside them lists each file.
usage: pull_coin_candles.py OUT_DIR
"""
import datetime, gzip, hashlib, io, json, os, sys, time, urllib.request

SYMBOLS = ["BTC-USD", "BTC-GBP", "ETH-USD", "ETH-GBP", "SOL-USD", "SOL-GBP", "XRP-USD", "XRP-GBP"]
START, END = "2025-11-25", "2026-09-23"
INTERVAL = 60


def ms(day):
    return int(datetime.datetime.fromisoformat(day + "T00:00").replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)


_last = [0.0]


def get_json(url):
    wait = _last[0] + 1.1 - time.time()
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/json"}), timeout=30) as r:
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500:
                return e.code, None
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(2 ** (attempt + 1))
        _last[0] = time.time()
    raise SystemExit(f"gave up on {url}")


def main():
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    a, z = ms(START), ms(END)
    step = INTERVAL * 60000 * 1000
    sums = []
    for sym in SYMBOLS:
        calls, rows = [], {}
        t = a
        while t < z:
            u = min(z, t + step)
            url = f"https://revx.revolut.com/api/1.0/public/candles/{sym}?interval={INTERVAL}&since={t}&until={u}&region=UK"
            st, d = get_json(url)
            data = (d.get("data") if isinstance(d, dict) else None) or []
            calls.append({"url": url, "status": st, "n": len(data)})
            for r in data:
                if a <= int(r["start"]) < z:
                    rows[int(r["start"])] = r
            t = u
        out = {"symbol": sym, "interval": INTERVAL, "region": "UK", "calls": calls, "rows": [rows[k] for k in sorted(rows)]}
        body = json.dumps(out, indent=0, sort_keys=True).encode()
        buf = io.BytesIO()
        with gzip.GzipFile(filename="", mode="wb", fileobj=buf, mtime=0) as g:
            g.write(body)
        name = f"{sym}_{INTERVAL}.json.gz"
        open(os.path.join(out_dir, name), "wb").write(buf.getvalue())
        sums.append(f"{hashlib.sha256(buf.getvalue()).hexdigest()}  {name}")
        print(sym, len(rows), "hours,", sum(1 for c in calls if c["status"] != 200), "calls not 200", flush=True)
    open(os.path.join(out_dir, "SHA256SUMS"), "w").write("\n".join(sums) + "\n")


if __name__ == "__main__":
    main()
