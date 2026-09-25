"""Pull the inputs this rule stores. No later year is requested as a signal.

    python3 docs/agents/scripts/fp223/fetch.py
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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

DATA = Path(os.environ.get("FP223_DATA", "/tmp/fp223/data"))
VISION = "https://data.binance.vision"
UA = {"User-Agent": "daviesportfolios-fp223-research"}


def get(url: str) -> bytes:
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as res:
                return res.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 404:
                raise RuntimeError("a file was not found: " + url) from exc
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
    y, m = 2022, 12
    while (y, m) <= (2023, 12):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def read_zip_rows(raw: bytes) -> list[list[str]]:
    zf = zipfile.ZipFile(io.BytesIO(raw))
    return list(csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())))


def pull_opens() -> dict[int, tuple]:
    rows: dict[int, tuple] = {}
    last = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    for ym in months():
        url = f"{VISION}/data/futures/um/monthly/klines/BTCUSDT/1d/BTCUSDT-1d-{ym}.zip"
        for row in read_zip_rows(get(url)):
            if not row or row[0] == "open_time":
                continue
            ts = int(row[0])
            if ts > c.fp5.SCREEN_END_MS:
                raise SystemExit("a later year was requested")
            if ts > last:
                continue
            rows[ts] = (float(row[1]),)
    if last not in rows:
        raise SystemExit("BTCUSDT has no 2023-12-31 bar")
    url = f"{VISION}/data/futures/um/daily/klines/BTCUSDT/1d/BTCUSDT-1d-2024-01-01.zip"
    kept = None
    for row in read_zip_rows(get(url)):
        if not row or row[0] == "open_time":
            continue
        if int(row[0]) != c.fp5.SCREEN_END_MS:
            raise SystemExit("the exit file holds another day")
        kept = (float(row[1]),)
    if kept is None:
        raise SystemExit("the 2024 bar was not in the exit file")
    rows[c.fp5.SCREEN_END_MS] = kept
    save("um1d/BTCUSDT.json", rows)
    return rows


def pull_funding() -> dict[int, tuple]:
    """Store the 16:00 rate only, keyed by that UTC day. Later hours are not stored."""
    rows: dict[int, tuple] = {}
    last = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    for ym in months():
        url = f"{VISION}/data/futures/um/monthly/fundingRate/BTCUSDT/BTCUSDT-fundingRate-{ym}.zip"
        for row in read_zip_rows(get(url)):
            if not row or row[0] in ("calc_time", "fundingTime") or len(row) < 3:
                continue
            bucket = c.fp5.bucket_8h(int(row[0]))
            if bucket is None or bucket >= c.fp5.SCREEN_END_MS:
                continue
            if bucket % c.fp5.DAY_MS != 2 * c.fp5.EIGHT_H_MS:
                continue
            day = bucket - 2 * c.fp5.EIGHT_H_MS
            if day > last:
                continue
            if day in rows:
                raise SystemExit(f"two funding prints share {day}")
            rows[day] = (float(row[2]),)
    if last not in rows:
        raise SystemExit("funding has no 2023-12-31 print")
    if any(ts >= c.fp5.SCREEN_END_MS for ts in rows):
        raise SystemExit("a 2024 funding print was stored")
    save("funding/BTCUSDT.json", rows)
    return rows


def main() -> None:
    if os.environ.get("FP223_OOS"):
        raise SystemExit("this pull does not request a later year")
    opens = pull_opens()
    fund = pull_funding()
    print(f"fp223 opens {len(opens)} funding {len(fund)}")


if __name__ == "__main__":
    main()
