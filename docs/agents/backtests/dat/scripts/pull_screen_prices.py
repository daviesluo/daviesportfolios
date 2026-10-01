"""DAT study, screen pull: MSTR daily bars (Yahoo chart API) and BTC-USD 15-minute candles (Coinbase Exchange public
candles), both ending 2024-12-31. Keyless, public GETs only.

Yahoo is asked for period1 = 2020-07-01 and period2 = 2024-12-31 23:59:59 UTC, so no later bar exists in the file; the
meta's current-price fields are dropped before the file is written (the meta keeps currency, exchange, symbol,
instrument type and first trade date only). Coinbase is asked for 2020-07-01 00:00 → 2025-01-01 00:00 UTC in 75-hour
pages; a candle is [start_sec, open, high, low, close, volume] ascending. Writes, gzipped with mtime 0:
  ../inputs/yahoo_MSTR_1d_screen.json.gz       {"symbol", "url", "meta", "rows": [[date_ET, t_sec, o, h, l, c, adjc, v]]}
  ../inputs/coinbase_BTC-USD_15m_screen.json.gz [[t, o, h, l, c, v], ...]
Run from anywhere: python3 docs/agents/backtests/dat/scripts/pull_screen_prices.py [MSTR] [BTC]
"""
import datetime as dt, gzip, json, os, sys, time, urllib.request
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
INP = os.path.join(HERE, "..", "inputs")
ET = ZoneInfo("America/New_York")
P1, P2 = 1593561600, 1735689599                     # 2020-07-01 00:00:00 UTC, 2024-12-31 23:59:59 UTC
CB_START = dt.datetime(2020, 7, 1, tzinfo=dt.timezone.utc)
CB_END = dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc)
KEEP_META = ("currency", "exchangeName", "symbol", "instrumentType", "firstTradeDate", "exchangeTimezoneName")


def get(url, ua="Mozilla/5.0 (research script)"):
    last = None
    for k in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": ua}), timeout=60) as r:
                return json.loads(r.read())
        except Exception as e:                                          # noqa: BLE001 - retried, then raised
            last = e
            time.sleep(1.5 * (k + 1))
    raise RuntimeError(f"failed {url}: {last}")


def write_gz(name, obj):
    with gzip.GzipFile(os.path.join(INP, name), "wb", mtime=0) as g:
        g.write(json.dumps(obj, separators=(",", ":")).encode())


def yahoo(sym):
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?period1={P1}&period2={P2}&interval=1d"
           f"&events=div%2Csplit&includeAdjustedClose=true")
    res = get(url)["chart"]["result"][0]
    meta = {k: res["meta"].get(k) for k in KEEP_META}
    q = res["indicators"]["quote"][0]
    adj = res["indicators"].get("adjclose", [{}])[0].get("adjclose") or q["close"]
    rows = []
    for i, t in enumerate(res["timestamp"]):
        day = dt.datetime.fromtimestamp(t, ET).strftime("%Y-%m-%d")
        if day > "2024-12-31":
            raise SystemExit("a bar after 2024-12-31 came back; nothing written")
        if q["close"][i] is None:
            continue
        rows.append([day, t, q["open"][i], q["high"][i], q["low"][i], q["close"][i], adj[i], q["volume"][i]])
    events = res.get("events", {})
    write_gz(f"yahoo_{sym}_1d_screen.json.gz", {"symbol": sym, "url": url, "meta": meta, "events": events, "rows": rows})
    print(sym, len(rows), rows[0][0], rows[-1][0], "splits:", list(events.get("splits", {}).values()))


def coinbase(product):
    rows, t = {}, CB_START
    while t < CB_END:
        e = min(t + dt.timedelta(minutes=15 * 300), CB_END)
        url = (f"https://api.exchange.coinbase.com/products/{product}/candles?granularity=900"
               f"&start={t.strftime('%Y-%m-%dT%H:%M:%SZ')}&end={e.strftime('%Y-%m-%dT%H:%M:%SZ')}")
        for c in get(url):
            if CB_START.timestamp() <= c[0] < CB_END.timestamp():
                rows[int(c[0])] = [int(c[0]), float(c[3]), float(c[2]), float(c[1]), float(c[4]), float(c[5])]
        t = e
        time.sleep(0.2)
    out = [rows[k] for k in sorted(rows)]
    write_gz(f"coinbase_{product}_15m_screen.json.gz", out)
    print(product, len(out), dt.datetime.utcfromtimestamp(out[0][0]), dt.datetime.utcfromtimestamp(out[-1][0]))


if __name__ == "__main__":
    what = sys.argv[1:] or ["MSTR", "BTC"]
    if "MSTR" in what:
        yahoo("MSTR")
    if "BTC" in what:
        coinbase("BTC-USD")
