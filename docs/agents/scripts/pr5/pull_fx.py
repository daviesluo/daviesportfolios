"""Pull the interbank GBP/USD candidates (public, keyless) for the whole span.

* FXCM's public candle archive: https://candledata.fxcorporate.com/m1/GBPUSD/<year>/<week>.csv.gz — one gzipped CSV of
  1-minute BID and ASK OHLC per trading week (Sunday ~22:00 UTC -> Friday ~21:00 UTC). A minute appears only when it ticked.
* Yahoo GBPUSD=X hourly, range=2y (the independent cross-check the brief names).
* Kraken's public trade tape for GBPUSD (ZGBPZUSD), sampled on chosen days (1,000 prints a call, ~8 calls a day), as a
  third, trade-built reference for the minute-level check.
Saves raw bodies under data/fx/ exactly as served.
usage: pull_fx.py fxcm | yahoo | kraken DAY [DAY ...]
"""
import json, os, sys, time, urllib.request, urllib.error, datetime

S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FX = os.path.join(S, "data", "fx")
UA = {"User-Agent": "daviesportfolios-research/1.0 (public market data)"}


def get(url, tries=5, timeout=60, ua=None):
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua} if ua else UA)
            with urllib.request.urlopen(req, timeout=timeout) as f:
                return 200, f.read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 403):
                return e.code, e.read()
            time.sleep(3 * (a + 1))
        except Exception:
            time.sleep(3 * (a + 1))
    return -1, b""


def fxcm():
    os.makedirs(os.path.join(FX, "fxcm"), exist_ok=True)
    log = []
    for year, weeks in ((2025, range(45, 54)), (2026, range(1, 41))):
        for w in weeks:
            fn = os.path.join(FX, "fxcm", f"GBPUSD_{year}_{w:02d}.csv.gz")
            if os.path.exists(fn) and os.path.getsize(fn) > 1000:
                continue
            st, body = get(f"https://candledata.fxcorporate.com/m1/GBPUSD/{year}/{w}.csv.gz")
            log.append({"year": year, "week": w, "status": st, "bytes": len(body)})
            print(year, w, st, len(body), flush=True)
            if st == 200 and len(body) > 1000:
                open(fn, "wb").write(body)
            time.sleep(0.5)
    json.dump(log, open(os.path.join(FX, "fxcm", "_pull_log.json"), "w"), indent=1)


def yahoo():
    st, body = get("https://query1.finance.yahoo.com/v8/finance/chart/GBPUSD=X?interval=1h&range=2y", ua="Mozilla/5.0")
    print("yahoo", st, len(body))
    open(os.path.join(FX, "yahoo_GBPUSD_1h_2y.json"), "wb").write(body)


def kraken(days):
    os.makedirs(os.path.join(FX, "kraken"), exist_ok=True)
    for day in days:
        a = int(datetime.datetime.fromisoformat(day + "T00:00").replace(tzinfo=datetime.timezone.utc).timestamp())
        z = a + 86400
        fn = os.path.join(FX, "kraken", f"GBPUSD_{day}.jsonl")
        if os.path.exists(fn):
            continue
        since = a * 10**9
        out = open(fn + ".part", "w")
        while True:
            st, body = get(f"https://api.kraken.com/0/public/Trades?pair=GBPUSD&since={since}")
            if st != 200:
                print("kraken fail", day, st); break
            d = json.loads(body)
            if d.get("error"):
                print("kraken err", d["error"]); time.sleep(5); continue
            out.write(json.dumps({"since": since, "result": d["result"]}) + "\n")
            rows = d["result"].get("ZGBPZUSD") or []
            last = int(d["result"]["last"])
            time.sleep(1.1)
            if not rows or rows[-1][2] >= z or last == since:
                break
            since = last
        out.close()
        os.rename(fn + ".part", fn)
        print("kraken", day, flush=True)


if __name__ == "__main__":
    what = sys.argv[1]
    if what == "fxcm": fxcm()
    elif what == "yahoo": yahoo()
    elif what == "kraken": kraken(sys.argv[2:])
