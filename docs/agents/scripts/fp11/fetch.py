"""Pull BTCUSDT perp book depth through 2023-12-31. No 2024 file is requested.

    python3 docs/agents/scripts/fp11/fetch.py
"""

from __future__ import annotations

import csv
import io
import json
import os
import sys
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

FP11 = Path(os.environ.get("FP11_DATA", "/tmp/fp11/data"))
VISION = "https://data.binance.vision/data/futures/um/daily/bookDepth/BTCUSDT"


def _days() -> list[str]:
    day = datetime(2022, 10, 1, tzinfo=timezone.utc)
    end = datetime(2023, 12, 31, tzinfo=timezone.utc)
    out = []
    while day <= end:
        out.append(day.strftime("%Y-%m-%d"))
        day += timedelta(days=1)
    return out


def _one(day: str) -> list[list[float]]:
    url = f"{VISION}/BTCUSDT-bookDepth-{day}.zip"
    request = urllib.request.Request(url, headers={"User-Agent": "fp11-screen"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read()
            break
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return []
            if attempt == 2:
                raise SystemExit(f"{day} http {error.code}")
        except urllib.error.URLError:
            if attempt == 2:
                raise SystemExit(f"{day} unreachable")
    zf = zipfile.ZipFile(io.BytesIO(raw))
    text = zf.read(zf.namelist()[0]).decode().splitlines()
    kept = []
    for row in csv.DictReader(text):
        pct = int(row["percentage"])
        if pct not in (-1, 1):
            continue
        stamp = datetime.strptime(row["timestamp"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        ts = int(stamp.timestamp() * 1000)
        if ts >= c.fp5.SCREEN_END_MS:
            continue
        kept.append([ts, pct, float(row["notional"])])
    return kept


def main() -> None:
    if os.environ.get("FP11_OOS"):
        raise SystemExit("this pull does not request a later year")
    days = _days()
    if days[-1] != "2023-12-31" or days[0] != "2022-10-01":
        raise SystemExit("the day list left the screen window")
    rows: list[list[float]] = []
    missing = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for kept in pool.map(_one, days):
            if not kept:
                missing += 1
            rows.extend(kept)
    rows.sort()
    FP11.mkdir(parents=True, exist_ok=True)
    (FP11 / "depth.json").write_text(json.dumps(rows, separators=(",", ":")))
    print(f"depth_rows {len(rows)} days {len(days)} empty_days {missing}")


if __name__ == "__main__":
    main()
