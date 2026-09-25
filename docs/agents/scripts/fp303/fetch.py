"""Pull the inputs this rule stores. No later year is requested as an entry.

    python3 docs/agents/scripts/fp303/fetch.py
"""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

DATA = Path(os.environ.get("FP303_DATA", "/tmp/fp303/data"))
VISION = "https://data.binance.vision"
UA = {"User-Agent": "daviesportfolios-fp303-research"}


def get(url: str) -> bytes:
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as res:
                return res.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code not in (418, 429, 500, 502, 503) or k + 1 == 6:
                raise
        except Exception as exc:
            last = exc
            if k + 1 == 6:
                raise
        time.sleep(1.0 * (k + 1))
    raise RuntimeError(f"get failed {last}")


def save(rel: str, rows: dict) -> None:
    path = DATA / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([[t, *rows[t]] for t in sorted(rows)], separators=(",", ":")))


def months() -> list[str]:
    out = []
    y, m = 2022, 11
    while (y, m) <= (2023, 12):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def read_zip_rows(raw: bytes) -> list[list[str]]:
    zf = zipfile.ZipFile(io.BytesIO(raw))
    return list(csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())))


def pull_binance(kind: str, symbol: str, folder: str) -> dict[int, tuple]:
    rows: dict[int, tuple] = {}
    for ym in months():
        if kind == "spot":
            url = f"{VISION}/data/spot/monthly/klines/{symbol}/1d/{symbol}-1d-{ym}.zip"
        else:
            url = f"{VISION}/data/futures/{kind}/monthly/klines/{symbol}/1d/{symbol}-1d-{ym}.zip"
        for row in read_zip_rows(get(url)):
            if not row or row[0] == "open_time":
                continue
            ts = int(row[0])
            if ts > c.fp5.SCREEN_END_MS:
                raise SystemExit("a later year was requested")
            rows[ts] = (float(row[1]), float(row[4]))
    if kind == "spot":
        url = f"{VISION}/data/spot/daily/klines/{symbol}/1d/{symbol}-1d-2024-01-01.zip"
    else:
        url = f"{VISION}/data/futures/{kind}/daily/klines/{symbol}/1d/{symbol}-1d-2024-01-01.zip"
    kept = None
    for row in read_zip_rows(get(url)):
        if not row or row[0] == "open_time":
            continue
        ts = int(row[0])
        if ts != c.fp5.SCREEN_END_MS:
            raise SystemExit("the exit file holds another day")
        kept = (float(row[1]), float(row[4]))
    if kept is None:
        raise SystemExit("the 2024 bar was not in the exit file")
    rows[c.fp5.SCREEN_END_MS] = kept
    if c.fp5.SCREEN_END_MS not in rows or max(rows) != c.fp5.SCREEN_END_MS:
        raise SystemExit(symbol + " stops on the wrong day")
    save(f"{folder}/{symbol}.json", rows)
    return rows


def pull_coinbase() -> dict[int, tuple]:
    rows: dict[int, tuple] = {}
    start = datetime(2022, 11, 1, tzinfo=timezone.utc)
    end = datetime(2024, 1, 1, tzinfo=timezone.utc)
    cursor = start
    while cursor < end:
        nxt_s = min(cursor.timestamp() + 250 * 86400, end.timestamp())
        nxt = datetime.fromtimestamp(nxt_s, timezone.utc)
        url = (
            "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400"
            f"&start={cursor.strftime('%Y-%m-%dT%H:%M:%SZ')}&end={nxt.strftime('%Y-%m-%dT%H:%M:%SZ')}"
        )
        for time_s, _low, _high, open_px, close_px, _vol in json.loads(get(url)):
            ts = int(time_s) * 1000
            if ts > c.FAIR_LAST_MS:
                continue
            stamp = datetime.fromtimestamp(int(time_s), timezone.utc)
            if stamp.hour != 0 or stamp.minute != 0:
                raise SystemExit("a Coinbase bucket does not start at 00:00 UTC")
            rows[ts] = (float(open_px), float(close_px))
        cursor = nxt
        time.sleep(0.2)
    if c.FAIR_LAST_MS not in rows or max(rows) != c.FAIR_LAST_MS:
        raise SystemExit("Coinbase stops on the wrong day")
    keys = sorted(rows)
    for left, right in zip(keys, keys[1:]):
        if right - left != c.fp5.DAY_MS:
            raise SystemExit("Coinbase is missing a day")
    save("cb1d/BTC-USD.json", rows)
    return rows


def pull_deribit() -> dict[int, tuple]:
    start = int(datetime(2022, 11, 1, tzinfo=timezone.utc).timestamp() * 1000)
    end = c.fp5.SCREEN_END_MS
    url = (
        "https://www.deribit.com/api/v2/public/get_tradingview_chart_data"
        f"?instrument_name=BTC-PERPETUAL&start_timestamp={start}&end_timestamp={end}&resolution=1D"
    )
    result = json.loads(get(url))["result"]
    if result.get("status") != "ok":
        raise SystemExit("Deribit did not return a closed series")
    rows: dict[int, tuple] = {}
    for tick, open_px, close_px in zip(result["ticks"], result["open"], result["close"]):
        ts = int(tick)
        if ts > c.FAIR_LAST_MS:
            continue
        stamp = datetime.fromtimestamp(ts / 1000, timezone.utc)
        if stamp.hour != 8 or stamp.minute != 0:
            raise SystemExit("a Deribit bucket does not start at 08:00 UTC")
        rows[ts] = (float(open_px), float(close_px))
    if c.FAIR_LAST_MS not in rows or max(rows) != c.FAIR_LAST_MS:
        raise SystemExit("Deribit stops on the wrong day")
    keys = sorted(rows)
    for left, right in zip(keys, keys[1:]):
        if right - left != c.fp5.DAY_MS:
            raise SystemExit("Deribit is missing a day")
    save("db1d/BTC-PERPETUAL.json", rows)
    return rows


def main() -> None:
    if os.environ.get("FP303_OOS"):
        raise SystemExit("this pull does not request a later year")
    kind = c.PULLS[0][0]
    symbol = c.PULLS[0][1]
    folder = c.PULLS[0][2]
    traded = pull_binance(kind, symbol, folder)
    if c.FAIR_KEY == "cb":
        fair = pull_coinbase()
    elif c.FAIR_KEY == "db":
        fair = pull_deribit()
    else:
        raise SystemExit("the fair value is not an external series")
    print(f"fp303 {len(traded)} {len(fair)}")


if __name__ == "__main__":
    main()
