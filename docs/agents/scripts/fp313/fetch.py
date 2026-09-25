"""Pull the inputs this rule stores. No later year is requested as an entry.

    python3 docs/agents/scripts/fp313/fetch.py
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

DATA = Path(os.environ.get("FP313_DATA", "/tmp/fp313/data"))
VISION = "https://data.binance.vision"
UA = {"User-Agent": "Mozilla/5.0 daviesportfolios-fp313-research"}
# fapi.binance.com and dapi.binance.com return 451 from this network. The
# history endpoint that matches the vision archive is on www.binance.com.
HISTORY = "https://www.binance.com/fapi/v1/fundingRate"


def get(url: str) -> bytes:
    if url.startswith("https://fapi.binance.com") or url.startswith("https://dapi.binance.com"):
        raise SystemExit("that host is not the one this pull measured")
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


def save_opens(rows: dict[int, float]) -> None:
    path = DATA / "um1d" / "BTCUSDT.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([[t, rows[t]] for t in sorted(rows)], separators=(",", ":")))


def months() -> list[str]:
    out = []
    y, m = 2023, 1
    while (y, m) <= (2023, 12):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def read_zip_rows(raw: bytes) -> list[list[str]]:
    zf = zipfile.ZipFile(io.BytesIO(raw))
    return list(csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())))


def pull_opens() -> dict[int, float]:
    rows: dict[int, float] = {}
    kind = "um"
    symbol = "BTCUSDT"
    for ym in months():
        url = f"{VISION}/data/futures/{kind}/monthly/klines/{symbol}/1d/{symbol}-1d-{ym}.zip"
        for row in read_zip_rows(get(url)):
            if not row or row[0] == "open_time":
                continue
            ts = int(row[0])
            if ts > c.fp5.SCREEN_END_MS:
                raise SystemExit("a later year was requested")
            px = float(row[1])
            if px <= 0.0:
                raise SystemExit("an open is not a price")
            rows[ts] = px
    url = (
        f"{VISION}/data/futures/{kind}/daily/klines/{symbol}/1d/"
        f"{symbol}-1d-2024-01-01.zip"
    )
    kept = None
    for row in read_zip_rows(get(url)):
        if not row or row[0] == "open_time":
            continue
        ts = int(row[0])
        if ts != c.fp5.SCREEN_END_MS:
            raise SystemExit("the exit file holds another day")
        kept = float(row[1])
    if kept is None or kept <= 0.0:
        raise SystemExit("the 2024 open was not in the exit file")
    rows[c.fp5.SCREEN_END_MS] = kept
    if len(rows) != c.BOOK_ROWS or max(rows) != c.fp5.SCREEN_END_MS:
        raise SystemExit(symbol + " stops on the wrong day")
    if kind == "cm":
        for iso in ("2023-08-28", "2023-08-29", "2023-08-30", "2023-08-31"):
            year, month, day = (int(part) for part in iso.split("-"))
            stamp = int(datetime(year, month, day, tzinfo=timezone.utc).timestamp() * 1000)
            if stamp in rows:
                raise SystemExit("the coin-margined gap was filled in")
    save_opens(rows)
    return rows


def pull_funding() -> dict[int, float]:
    rows: dict[int, float] = {}
    cursor = c.FUND_FIRST - 1
    end = c.fp5.SCREEN_END_MS
    while cursor < end:
        url = f"{HISTORY}?symbol=BTCUSDT&startTime={cursor}&endTime={end}&limit=1000"
        batch = json.loads(get(url).decode())
        if not batch:
            break
        for row in batch:
            ts = int(row["fundingTime"])
            if ts >= end:
                continue
            rate = float(row["fundingRate"])
            if ts in rows and rows[ts] != rate:
                raise SystemExit("two funding rates at one stamp")
            rows[ts] = rate
        last = int(batch[-1]["fundingTime"])
        if last + 1 <= cursor or len(batch) < 1000:
            break
        cursor = last + 1
        time.sleep(0.15)
    stamps = sorted(rows)
    if len(stamps) != c.FUND_N or stamps[0] != c.FUND_FIRST or stamps[-1] != c.FUND_LAST:
        raise SystemExit("funding does not have the frozen shape")
    for left, right in zip(stamps, stamps[1:]):
        if abs((right - left) - c.fp5.EIGHT_H_MS) > 120_000:
            raise SystemExit("a funding settlement is missing")
    path = DATA / "fund" / "BTCUSDT.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([[t, rows[t]] for t in stamps], separators=(",", ":")))
    return rows


def main() -> None:
    if os.environ.get("FP313_OOS"):
        raise SystemExit("this pull does not request a later year")
    opens = pull_opens()
    fund = pull_funding()
    print(f"fp313 {len(opens)} {len(fund)}")


if __name__ == "__main__":
    main()
