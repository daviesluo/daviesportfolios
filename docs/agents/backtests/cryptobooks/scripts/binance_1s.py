# CRYPTOBOOKS (2026-10-31): Binance's public 1-second klines (data.binance.vision daily zips, keyless) turned into one
# float64 close a second per coin, UTC, forward-filled across seconds with no trade, for [FROM, TO). Binance's spot book
# is one tick wide on these coins, so its last trade a second is the outside fair this study marks Revolut X against.
# Writes <out>/<COIN>.f64 (86,400 closes a day, days in order) and <out>/index.json. Too big to commit (16 coins x 14
# days x 0.7 MB); the zips stay public, so this script is the record.
#   SSL_CERT_FILE=<the proxy's CA bundle> python3 -I binance_1s.py <out dir> <from YYYY-MM-DD> <to> COIN...
import array, concurrent.futures as cf, csv, datetime as dt, io, json, os, sys, time, urllib.error, urllib.request, zipfile


def api_closes(coin, t0):
    """A day not yet in the archive (today): the public klines endpoint, 1,000 seconds a request, up to now."""
    out = [float("nan")] * 86400
    now = int(time.time()) - 5
    s = t0
    while s < min(t0 + 86400, now):
        url = (f"https://data-api.binance.vision/api/v3/klines?symbol={coin}USDT&interval=1s&startTime={s * 1000}"
               f"&endTime={min(s + 1000, now) * 1000 - 1}&limit=1000")
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "crypto-books-study"}), timeout=60) as r:
            for k in json.load(r):
                i = k[0] // 1000 - t0
                if 0 <= i < 86400:
                    out[i] = float(k[4])
        s += 1000
        time.sleep(0.2)
    return out


def day_closes(coin, day):
    t0 = int(dt.datetime.fromisoformat(day).replace(tzinfo=dt.timezone.utc).timestamp())
    url = f"https://data.binance.vision/data/spot/daily/klines/{coin}USDT/1s/{coin}USDT-1s-{day}.zip"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "crypto-books-study"}), timeout=120) as r:
            z = zipfile.ZipFile(io.BytesIO(r.read()))
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        return api_closes(coin, t0)
    out = [float("nan")] * 86400
    with z.open(z.namelist()[0]) as f:
        for row in csv.reader(io.TextIOWrapper(f)):
            if not row or not row[0].isdigit():
                continue
            ot = int(row[0])
            sec = ot // 1_000_000 if ot > 10 ** 14 else ot // 1000  # microseconds since 2025, milliseconds before
            i = sec - t0
            if 0 <= i < 86400:
                out[i] = float(row[4])
    return out


def main(out_dir, d0, d1, coins):
    os.makedirs(out_dir, exist_ok=True)
    a, b = dt.date.fromisoformat(d0), dt.date.fromisoformat(d1)
    days = [(a + dt.timedelta(days=k)).isoformat() for k in range((b - a).days)]
    for coin in coins:
        with cf.ThreadPoolExecutor(4) as ex:
            res = list(ex.map(lambda d: day_closes(coin, d), days))
        last = float("nan")
        arr = array.array("d")
        for day in res:
            for v in day:
                if v == v:
                    last = v
                arr.append(last)
        first = next((v for v in arr if v == v), float("nan"))  # the first seconds before any trade take the first close
        for i in range(len(arr)):
            if arr[i] != arr[i]:
                arr[i] = first
            else:
                break
        with open(os.path.join(out_dir, f"{coin}.f64"), "wb") as f:
            arr.tofile(f)
        print(coin, len(arr), flush=True)
    with open(os.path.join(out_dir, "index.json"), "w") as f:
        json.dump({"from": d0, "to": d1, "t0": int(dt.datetime.fromisoformat(d0).replace(tzinfo=dt.timezone.utc).timestamp()),
                   "coins": coins}, f)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:])
