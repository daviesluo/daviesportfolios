"""Pull the inputs this rule stores. No later year is requested as a signal.

    python3 docs/agents/scripts/fp224/fetch.py
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

DATA = Path(os.environ.get("FP224_DATA", "/tmp/fp224/data"))
VISION = "https://data.binance.vision"
UA = {"User-Agent": "daviesportfolios-fp224-research"}


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


def pull_cm() -> dict[int, tuple]:
    """Open and close. The 2024-01-01 open is an exit, not a signal."""
    rows: dict[int, tuple] = {}
    last = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    for ym in months():
        url = f"{VISION}/data/futures/cm/monthly/klines/BTCUSD_PERP/1d/BTCUSD_PERP-1d-{ym}.zip"
        for row in read_zip_rows(get(url)):
            if not row or row[0] == "open_time":
                continue
            ts = int(row[0])
            if ts > c.fp5.SCREEN_END_MS:
                raise SystemExit("a later year was requested")
            if ts > last:
                continue
            rows[ts] = (float(row[1]), float(row[4]))
    if last not in rows:
        raise SystemExit("the coin-margined book has no 2023-12-31 bar")
    url = f"{VISION}/data/futures/cm/daily/klines/BTCUSD_PERP/1d/BTCUSD_PERP-1d-2024-01-01.zip"
    kept = None
    for row in read_zip_rows(get(url)):
        if not row or row[0] == "open_time":
            continue
        if int(row[0]) != c.fp5.SCREEN_END_MS:
            raise SystemExit("the exit file holds another day")
        kept = (float(row[1]), float(row[4]))
    if kept is None:
        raise SystemExit("the 2024 bar was not in the exit file")
    rows[c.fp5.SCREEN_END_MS] = kept
    save("cm1d/BTCUSD_PERP.json", rows)
    return rows


def pull_um_closes() -> dict[int, tuple]:
    """Closes through 2023-12-31. The USDT book is a signal, not a fill."""
    rows: dict[int, tuple] = {}
    last = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    for ym in months():
        url = f"{VISION}/data/futures/um/monthly/klines/BTCUSDT/1d/BTCUSDT-1d-{ym}.zip"
        for row in read_zip_rows(get(url)):
            if not row or row[0] == "open_time":
                continue
            ts = int(row[0])
            if ts > last:
                if ts > c.fp5.SCREEN_END_MS:
                    raise SystemExit("a later year was requested")
                continue
            rows[ts] = (float(row[4]),)
    if last not in rows or max(rows) != last:
        raise SystemExit("the USDT closes stop on the wrong day")
    save("um1d/BTCUSDT.json", rows)
    return rows


def main() -> None:
    if os.environ.get("FP224_OOS"):
        raise SystemExit("this pull does not request a later year")
    cm = pull_cm()
    um = pull_um_closes()
    print(f"fp224 cm {len(cm)} um {len(um)}")


if __name__ == "__main__":
    main()
