"""Pull BTCDOMUSDT 8h bars through December 2023. No 2024 month is requested.

    python3 docs/agents/scripts/fp12/fetch.py
"""

from __future__ import annotations

import io
import json
import os
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

FP12 = Path(os.environ.get("FP12_DATA", "/tmp/fp12/data"))
VISION = "https://data.binance.vision/data/futures/um/monthly/klines/BTCDOMUSDT/8h"


def _months() -> list[str]:
    out = []
    year, month = 2022, 10
    while (year, month) <= (2023, 12):
        out.append(f"{year}-{month:02d}")
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return out


def _month(ym: str) -> list[list[float]]:
    url = f"{VISION}/BTCDOMUSDT-8h-{ym}.zip"
    request = urllib.request.Request(url, headers={"User-Agent": "fp12-screen"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return []
        raise SystemExit(f"{ym} http {error.code}")
    zf = zipfile.ZipFile(io.BytesIO(raw))
    kept = []
    for line in zf.read(zf.namelist()[0]).decode().splitlines():
        parts = line.split(",")
        if not parts or not parts[0].isdigit():
            continue
        open_ms = int(parts[0])
        if open_ms >= c.fp5.SCREEN_END_MS:
            continue
        kept.append([
            open_ms,
            float(parts[1]),
            float(parts[2]),
            float(parts[3]),
            float(parts[4]),
            float(parts[7]) if len(parts) > 7 and parts[7] else 0.0,
        ])
    return kept


def main() -> None:
    if os.environ.get("FP12_OOS"):
        raise SystemExit("this pull does not request a later year")
    months = _months()
    if months[0] != "2022-10" or months[-1] != "2023-12":
        raise SystemExit("the month list left the screen window")
    rows: list[list[float]] = []
    missing = 0
    for ym in months:
        kept = _month(ym)
        if not kept:
            missing += 1
        rows.extend(kept)
    rows.sort()
    FP12.mkdir(parents=True, exist_ok=True)
    (FP12 / "dom8h.json").write_text(json.dumps(rows, separators=(",", ":")))
    print(f"dom_rows {len(rows)} months {len(months)} empty_months {missing}")


if __name__ == "__main__":
    main()
