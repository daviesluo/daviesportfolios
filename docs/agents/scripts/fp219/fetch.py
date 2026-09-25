"""Pull the inputs this rule stores. No later year is requested as a signal.

    python3 docs/agents/scripts/fp219/fetch.py
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

DATA = Path(os.environ.get("FP219_DATA", "/tmp/fp219/data"))
VISION = "https://data.binance.vision"
UA = {"User-Agent": "daviesportfolios-fp219-research"}


def get(url: str, missing_ok: bool = False) -> bytes | None:
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as res:
                return res.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 404:
                if missing_ok:
                    return None
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


def pull_quarter(symbol: str, expiry: int) -> dict[int, tuple]:
    rows: dict[int, tuple] = {}
    for ym in months():
        url = (
            f"{VISION}/data/futures/cm/monthly/klines/{symbol}/1d/"
            f"{symbol}-1d-{ym}.zip"
        )
        raw = get(url, missing_ok=True)
        if raw is None:
            continue
        for row in read_zip_rows(raw):
            if not row or row[0] == "open_time":
                continue
            ts = int(row[0])
            if ts > c.fp5.SCREEN_END_MS:
                raise SystemExit("a later year was requested")
            if ts > expiry:
                continue
            rows[ts] = (float(row[1]),)
    if expiry not in rows:
        raise SystemExit(symbol + " has no expiry bar")
    if max(rows) > expiry:
        raise SystemExit(symbol + " keeps a bar after expiry")
    save(f"cm1d/{symbol}.json", rows)
    return rows


def main() -> None:
    if os.environ.get("FP219_OOS"):
        raise SystemExit("this pull does not request a later year")
    counts = []
    for expiry, symbol in c.QUARTERS:
        counts.append(len(pull_quarter(symbol, expiry)))
    print("fp219 " + " ".join(str(n) for n in counts))


if __name__ == "__main__":
    main()
