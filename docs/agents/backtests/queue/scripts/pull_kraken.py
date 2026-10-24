"""QUEUE "Data" item 3: Kraken's keyless hourly OHLC of USDT/USD and USDC/USD, saved as received to
<dir>/<YYYY-MM-DD>-<PAIR>.json with a MANIFEST.json of bar counts, first and forming bars, byte lengths and sha256 (the
spare pull of 2026-10-18 under backtests/queue/kraken/ has the same layout). The main pull is made on 2026-11-02 between
00:05 and 19:59 UTC; one reply then holds every hour needed (2026-10-03 21:00 -> 2026-11-01 22:00). Prints only counts and
hashes. Written 2026-10-24.

    python3 -I docs/agents/backtests/queue/scripts/pull_kraken.py <data>/kraken
    python3 -I docs/agents/backtests/queue/scripts/pull_kraken.py trades <data>/kraken_trades   (only if an hour is missing:
        every trade since 2026-10-03 21:00 UTC, paged to the end, [[price, volume, time], ...] gzipped per pair)
"""
import datetime, hashlib, json, os, sys, time, urllib.request

PAIRS = [("USDTUSD", "USDTZUSD"), ("USDCUSD", "USDCUSD")]


def iso(s):
    return datetime.datetime.fromtimestamp(s, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def main(out):
    os.makedirs(out, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc)
    man = {"what": "QUEUE Data item 3 main pull: Kraken public OHLC, interval=60, keyless, raw replies as received",
           "pulled_utc": now.strftime("%Y-%m-%dT%H:%MZ"), "files": []}
    for pair, key in PAIRS:
        url = f"https://api.kraken.com/0/public/OHLC?pair={pair}&interval=60"
        body = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "daviesportfolios-research/1.0"}), timeout=60).read()
        fn = f"{now:%Y-%m-%d}-{pair}.json"
        open(os.path.join(out, fn), "wb").write(body)
        rows = json.loads(body)["result"][key]
        man["files"].append({"file": fn, "url": url, "key": key, "bars": len(rows), "first_bar": iso(int(rows[0][0])),
                             "last_bar_forming": iso(int(rows[-1][0])), "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()})
        print(fn, len(rows), man["files"][-1]["sha256"])
        time.sleep(1.1)
    json.dump(man, open(os.path.join(out, "MANIFEST.json"), "w"), indent=2)


def trades(out):
    import gzip
    os.makedirs(out, exist_ok=True)
    since0 = int(datetime.datetime(2026, 10, 3, 21, tzinfo=datetime.timezone.utc).timestamp()) * 10 ** 9
    for pair, key in PAIRS:
        since, rows = since0, []
        while True:
            url = f"https://api.kraken.com/0/public/Trades?pair={pair}&since={since}"
            rep = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "daviesportfolios-research/1.0"}), timeout=60).read())
            got = rep["result"][key]
            rows += [[t[0], t[1], t[2]] for t in got]
            last = int(rep["result"]["last"])
            time.sleep(1.1)
            if not got or last == since:
                break
            since = last
        body = json.dumps(rows).encode()
        with open(os.path.join(out, f"{pair}.json.gz"), "wb") as f:
            with gzip.GzipFile(fileobj=f, mode="wb", mtime=0, filename="") as g:
                g.write(body)
        print(pair, len(rows), hashlib.sha256(body).hexdigest())


if __name__ == "__main__":
    if sys.argv[1] == "trades":
        trades(sys.argv[2])
    else:
        main(sys.argv[1])
