"""Pull the inputs this rule stores. No later year is requested as an entry.

    python3 docs/agents/scripts/fp311/fetch.py
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

DATA = Path(os.environ.get("FP311_DATA", "/tmp/fp311/data"))
VISION = "https://data.binance.vision"
UA = {"User-Agent": "daviesportfolios-fp311-research"}


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


def check_fair(rows: dict[int, tuple], name: str) -> None:
    if c.FAIR_LAST_MS not in rows or max(rows) != c.FAIR_LAST_MS:
        raise SystemExit(name + " stops on the wrong day")
    if min(rows) != c.LOOKBACK_MS:
        raise SystemExit(name + " starts on the wrong day")
    keys = sorted(rows)
    for left, right in zip(keys, keys[1:]):
        if right - left != c.fp5.DAY_MS:
            raise SystemExit(name + " is missing a day")
    hour = c.FAIR_SHIFT_MS // 3_600_000
    for ts in keys:
        stamp = datetime.fromtimestamp(ts / 1000, timezone.utc)
        if stamp.hour != hour or stamp.minute != 0 or stamp.second != 0:
            raise SystemExit(name + " bucket does not start on its clock")


def keep_fair(ts: int) -> bool:
    return c.LOOKBACK_MS <= ts <= c.FAIR_LAST_MS


def pull_htx() -> dict[int, tuple]:
    url = "https://api.huobi.pro/market/history/kline?symbol=btcusdt&period=1day&size=2000"
    payload = json.loads(get(url))
    if payload.get("status") != "ok":
        raise SystemExit("HTX refused the candles")
    rows: dict[int, tuple] = {}
    for bar in payload["data"]:
        ts = int(bar["id"]) * 1000
        if not keep_fair(ts):
            continue
        rows[ts] = (float(bar["open"]), float(bar["close"]))
    check_fair(rows, "HTX")
    save("hx1d/btcusdt.json", rows)
    return rows


def main() -> None:
    if os.environ.get("FP311_OOS"):
        raise SystemExit("this pull does not request a later year")
    kind = c.PULLS[0][0]
    symbol = c.PULLS[0][1]
    folder = c.PULLS[0][2]
    traded = pull_binance(kind, symbol, folder)
    fair = pull_htx()
    print(f"fp311 {len(traded)} {len(fair)}")


if __name__ == "__main__":
    main()
