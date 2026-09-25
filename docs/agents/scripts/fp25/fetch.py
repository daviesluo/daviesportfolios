"""Pull exchange-held BTC and BTCUSDT daily opens for the fp25 screen.

No later year is requested. A stock stamp on or after 2024-01-01 is not
stored. The daily file keeps the 2024-01-01 open because it can be the
exit of the last 2023 entry. A later open is a bug. The spot file stores
the open only. Inflow and outflow are not requested.

    python3 docs/agents/scripts/fp25/fetch.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

DATA = Path(os.environ.get("FP25_DATA", "/tmp/fp25/data"))
CM = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp25-research"}
METRIC = "SplyExNtv"


def get(url: str) -> bytes:
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 404:
                raise RuntimeError(f"not found: {url}") from exc
            if exc.code not in (418, 429, 500, 502, 503) or k + 1 == 6:
                raise
        except Exception as exc:
            last = exc
            if k + 1 == 6:
                raise
        time.sleep(1.0 * (k + 1))
    raise RuntimeError(f"get failed {last}")


def day_ms(stamp: str) -> int:
    if len(stamp) < 10 or stamp[4] != "-" or stamp[7] != "-":
        raise RuntimeError(f"time is not YYYY-MM-DD: {stamp[:16]}")
    y, m, d = int(stamp[0:4]), int(stamp[5:7]), int(stamp[8:10])
    return int(datetime(y, m, d, tzinfo=timezone.utc).timestamp() * 1000)


def pull_stock() -> list[list]:
    url = (
        f"{CM}?assets=btc&metrics={METRIC}&frequency=1d"
        f"&start_time=2022-10-01&end_time=2024-01-01&page_size=10000"
    )
    rows: dict[int, float] = {}
    pages = 0
    while url:
        pages += 1
        if pages > 10:
            raise RuntimeError("pagination did not end")
        body = json.loads(get(url))
        for row in body.get("data") or []:
            if row.get(METRIC) is None:
                continue
            ts = day_ms(str(row["time"]))
            if ts < LOOKBACK_MS or ts >= c.fp5.SCREEN_END_MS:
                continue
            if ts in rows:
                raise RuntimeError(f"duplicate stock stamp {ts}")
            rows[ts] = float(row[METRIC])
        url = body.get("next_page_url") or ""
    return [[ts, rows[ts]] for ts in sorted(rows)]


def pull_opens() -> dict[int, tuple]:
    end_ms = c.fp5.SCREEN_END_MS
    cursor = LOOKBACK_MS
    rows: dict[int, tuple] = {}
    while cursor <= end_ms:
        url = (
            f"{MARKET}/api/v3/klines?symbol=BTCUSDT&interval=1d"
            f"&startTime={cursor}&endTime={end_ms}&limit=1000"
        )
        batch = json.loads(get(url))
        if not batch:
            break
        for k in batch:
            if len(k) < 2:
                raise SystemExit("a daily kline is missing the open")
            open_ms = int(k[0])
            if open_ms < LOOKBACK_MS:
                continue
            if open_ms > end_ms:
                raise SystemExit(f"a daily bar opened past the screen: {open_ms}")
            rows[open_ms] = (float(k[1]),)
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    return rows


def main() -> None:
    if os.environ.get("FP25_OOS"):
        raise SystemExit("this pull does not request a later year")
    stock = pull_stock()
    if any(row[0] >= c.fp5.SCREEN_END_MS for row in stock):
        raise SystemExit("a stock stamp is on or after 2024-01-01")
    daily = pull_opens()
    if any(t > c.fp5.SCREEN_END_MS for t in daily):
        raise SystemExit("a daily bar opened after 2024-01-01")
    if not stock or not daily:
        raise SystemExit("the stock series or the daily opens came back empty")
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "SplyExNtv.json").write_text(json.dumps(stock, separators=(",", ":")))
    spot = DATA / "spot1d"
    spot.mkdir(parents=True, exist_ok=True)
    payload = [[t, *daily[t]] for t in sorted(daily)]
    (spot / "BTCUSDT.json").write_text(json.dumps(payload, separators=(",", ":")))
    print(
        f"fp25 SplyExNtv {len(stock)} first {stock[0][0]} last {stock[-1][0]}; "
        f"1d {len(daily)} first {min(daily)} last {max(daily)}"
    )


if __name__ == "__main__":
    main()
