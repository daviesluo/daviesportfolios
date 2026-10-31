# CRYPTOBOOKS-2 (2026-10-31): the outside fair for hist_pull.py's year of 13:00-16:00 UTC windows, keyless:
#  - Binance's one-second klines of COIN-USDT for 12:55 -> 16:10 UTC each day (the public klines endpoint, 1,000 a request);
#  - Coinbase's one-minute candles of BTC-USD, BTC-GBP (their ratio is GBP/USD, a Saturday's too) and USDT-USD, 12:50 -> 16:10.
# Writes <out>/<COIN>_<day>.f64 (11,700 closes, forward-filled) and <out>/fx_<day>.json ({minute: [gbpusd, usdtusd]}).
# Too big to commit; this script is the record.
#   SSL_CERT_FILE=<the proxy's CA bundle> python3 -I hist_fair.py <out dir> <from YYYY-MM-DD> <to> COIN...
import array, concurrent.futures as cf, datetime as dt, json, os, sys, time, urllib.request

W0, W1 = 12 * 3600 + 55 * 60, 16 * 3600 + 10 * 60  # seconds after midnight
UA = {"User-Agent": "crypto-books-study"}


def get(url):
    for k in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.load(r)
        except Exception:
            time.sleep(2 + 3 * k)
    raise RuntimeError(url)


def main(out, d0, d1, coins):
    os.makedirs(out, exist_ok=True)
    a, b = dt.date.fromisoformat(d0), dt.date.fromisoformat(d1)
    days = [a + dt.timedelta(days=k) for k in range((b - a).days)]
    with cf.ThreadPoolExecutor(6) as ex:  # six days at a time, inside both venues' public limits
        list(ex.map(lambda d: one_day(out, d, coins), days))


def one_day(out, day, coins):
    if True:
        t_day = int(dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc).timestamp())
        for coin in coins:
            path = os.path.join(out, f"{coin}_{day.isoformat()}.f64")
            if os.path.exists(path):
                continue
            vals = [float("nan")] * (W1 - W0)
            s = t_day + W0
            while s < t_day + W1:
                e = min(s + 1000, t_day + W1)
                for k in get(f"https://data-api.binance.vision/api/v3/klines?symbol={coin}USDT&interval=1s&startTime={s * 1000}"
                             f"&endTime={e * 1000 - 1}&limit=1000"):
                    i = k[0] // 1000 - t_day - W0
                    if 0 <= i < len(vals):
                        vals[i] = float(k[4])
                s = e
                time.sleep(0.12)
            last = next((v for v in vals if v == v), float("nan"))
            arr = array.array("d")
            for v in vals:
                if v == v:
                    last = v
                arr.append(last)
            with open(path, "wb") as f:
                arr.tofile(f)
        fx_path = os.path.join(out, f"fx_{day.isoformat()}.json")
        if not os.path.exists(fx_path):
            st = dt.datetime.utcfromtimestamp(t_day + W0 - 300).strftime("%Y-%m-%dT%H:%M:%SZ")
            en = dt.datetime.utcfromtimestamp(t_day + W1).strftime("%Y-%m-%dT%H:%M:%SZ")
            c = {}
            for p in ("BTC-USD", "BTC-GBP", "USDT-USD"):
                c[p] = {int(r[0]): float(r[4]) for r in get(f"https://api.exchange.coinbase.com/products/{p}/candles?granularity=60&start={st}&end={en}")}
                time.sleep(0.35)
            fx = {m: [c["BTC-USD"][m] / c["BTC-GBP"][m], c["USDT-USD"].get(m)] for m in sorted(c["BTC-GBP"]) if m in c["BTC-USD"]}
            json.dump(fx, open(fx_path, "w"))
        print(day, flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:])
