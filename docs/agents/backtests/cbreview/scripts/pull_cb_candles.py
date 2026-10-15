"""Keyless pull of Coinbase Exchange 1-minute candles (public endpoint, no key) for the fast-move study's FX-lag measurement:
USDT-USD and USDT-EUR, 2026-09-09 .. 2026-10-15 00:00 UTC, written as ../inputs/cb_implied_eurusd.json.gz = {t0, usd, eur}
where usd[i] / eur[i] are the CLOSE of the candle starting at t0 + i minutes (null when the product printed nothing that
minute; USDT-EUR is thin: about half the minutes). The implied EUR/USD of a minute is usd / eur when both exist.
usage: python3 -I pull_cb_candles.py  (about two minutes; needs outbound HTTPS to api.exchange.coinbase.com)
"""
import concurrent.futures as cf, datetime, gzip, json, os, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
UTC = datetime.timezone.utc
T0 = int(datetime.datetime(2026, 9, 9, tzinfo=UTC).timestamp())
T1 = int(datetime.datetime(2026, 10, 15, tzinfo=UTC).timestamp())


def iso(t):
    return datetime.datetime.fromtimestamp(t, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def get(prod, a, b):
    u = f"https://api.exchange.coinbase.com/products/{prod}/candles?granularity=60&start={iso(a)}&end={iso(b)}"
    for k in range(6):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "cbfast"}), timeout=30))
        except Exception:
            time.sleep(1 + k)
    raise RuntimeError(u)


def pull(prod):
    jobs = [(a, min(a + 300 * 60, T1)) for a in range(T0, T1, 300 * 60)]
    out = {}
    with cf.ThreadPoolExecutor(4) as ex:
        for rows in ex.map(lambda j: get(prod, *j), jobs):
            for r in rows:
                out[r[0]] = r[4]            # [time, low, high, open, close, volume]
    return out


def main():
    u, e = pull("USDT-USD"), pull("USDT-EUR")
    n = (T1 - T0) // 60
    ser = lambda d: [d.get(T0 + i * 60) for i in range(n)]
    json.dump({"t0": T0 * 1000, "usd": ser(u), "eur": ser(e)}, gzip.open(os.path.join(ROOT, "inputs", "cb_implied_eurusd.json.gz"), "wt"), separators=(",", ":"))
    print(len(u), len(e))


if __name__ == "__main__":
    main()
