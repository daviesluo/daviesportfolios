"""DAT study, descriptive pull (design.md §8 step 5, run only after the MSTR screen's verdict was written down,
notes/verdict_mstr_screen.md): daily bars of BMNR and the treasury companies of the event list, and hourly BTC, ETH and
SOL candles, 2025-05-01 → 2026-09-30. MSTR is NOT pulled here: its held-out years stay unread.

Yahoo chart API (meta stripped to currency, exchange, symbol, type, first trade date) and Coinbase Exchange public
hourly candles. Writes, gzipped with mtime 0:
  ../inputs/descriptive/yahoo_<SYM>_1d.json.gz        {"symbol", "url", "meta", "rows": [[date_local, t, o, h, l, c, adjc, v]]}
  ../inputs/descriptive/coinbase_<COIN>-USD_1h.json.gz [[t, o, h, l, c, v], ...]
FG Nexus (FGNX in 2025) trades as FG Communities (FGC); Yahoo keeps its history under FGC. ETHZilla (ETHZ) is FRMM.
Run: python3 docs/agents/backtests/dat/scripts/pull_descriptive.py
"""
import datetime as dt, gzip, json, os, time, urllib.request
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "inputs", "descriptive")
P1, P2 = 1746057600, 1790812799                      # 2025-05-01 00:00:00 UTC, 2026-09-30 23:59:59 UTC
CB_START = dt.datetime(2025, 5, 1, tzinfo=dt.timezone.utc)
CB_END = dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc)
SYMBOLS = ["BMNR", "SBET", "FRMM", "FGC", "EMPD", "UPXI", "SQNS", "ASST", "3350.T", "SATS.L"]
COINS = ["BTC", "ETH", "SOL"]
KEEP_META = ("currency", "exchangeName", "symbol", "instrumentType", "firstTradeDate", "exchangeTimezoneName")


def get(url):
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (research script)"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except Exception as e:                                          # noqa: BLE001 - retried, then raised
            last = e
            time.sleep(1.5 * (k + 1))
    raise RuntimeError(f"failed {url}: {last}")


def write_gz(name, obj):
    with gzip.GzipFile(os.path.join(OUT, name), "wb", mtime=0) as g:
        g.write(json.dumps(obj, separators=(",", ":")).encode())


def yahoo(sym):
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?period1={P1}&period2={P2}&interval=1d"
           f"&events=div%2Csplit&includeAdjustedClose=true")
    res = get(url)["chart"]["result"][0]
    meta = {k: res["meta"].get(k) for k in KEEP_META}
    tz = ZoneInfo(res["meta"].get("exchangeTimezoneName") or "America/New_York")
    q = res["indicators"]["quote"][0]
    if "close" not in q:
        print(sym, "no bars in the window; nothing written")
        return
    adj = res["indicators"].get("adjclose", [{}])[0].get("adjclose") or q["close"]
    rows = [[dt.datetime.fromtimestamp(t, tz).strftime("%Y-%m-%d"), t, q["open"][i], q["high"][i], q["low"][i],
             q["close"][i], adj[i], q["volume"][i]] for i, t in enumerate(res.get("timestamp") or []) if q["close"][i] is not None]
    write_gz(f"yahoo_{sym}_1d.json.gz", {"symbol": sym, "url": url, "meta": meta, "events": res.get("events", {}), "rows": rows})
    print(sym, len(rows), rows[0][0] if rows else None, rows[-1][0] if rows else None, meta.get("currency"))


def coinbase(coin):
    rows, t = {}, CB_START
    while t < CB_END:
        e = min(t + dt.timedelta(hours=300), CB_END)
        url = (f"https://api.exchange.coinbase.com/products/{coin}-USD/candles?granularity=3600"
               f"&start={t.strftime('%Y-%m-%dT%H:%M:%SZ')}&end={e.strftime('%Y-%m-%dT%H:%M:%SZ')}")
        for c in get(url):
            if CB_START.timestamp() <= c[0] < CB_END.timestamp():
                rows[int(c[0])] = [int(c[0]), float(c[3]), float(c[2]), float(c[1]), float(c[4]), float(c[5])]
        t = e
        time.sleep(0.2)
    out = [rows[k] for k in sorted(rows)]
    write_gz(f"coinbase_{coin}-USD_1h.json.gz", out)
    print(coin, len(out), dt.datetime.utcfromtimestamp(out[0][0]), dt.datetime.utcfromtimestamp(out[-1][0]))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for s in SYMBOLS:
        yahoo(s)
        time.sleep(0.5)
    for c in COINS:
        coinbase(c)
