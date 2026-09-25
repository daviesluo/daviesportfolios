"""Download the PEPE spot and perpetual daily bars. No return is computed."""

from __future__ import annotations

import json
import os
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

ROOT = Path(os.environ.get("FP333_DATA", "/tmp/fp333/data"))
VISION = "https://data.binance.vision/data"
MONTHS = [f"2023-{m:02d}" for m in range(5, 13)]


def _kline(url: str) -> list[tuple[int, str, str]]:
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
    with urllib.request.urlopen(req, timeout=60) as response:
        payload = response.read()
    with zipfile.ZipFile(BytesIO(payload)) as archive:
        raw = archive.read(archive.namelist()[0]).decode().splitlines()
    rows = []
    for line in raw:
        if not line or not line[0].isdigit():
            continue
        parts = line.split(",")
        stamp = int(float(parts[0]))
        if stamp > 10**14:
            stamp //= 1000
        rows.append((stamp, parts[1], parts[4]))
    return rows


def _write(path: Path, rows: list[tuple[int, str, str]]) -> None:
    merged: dict[int, tuple[str, str]] = {}
    for stamp, opened, closed in rows:
        merged[stamp] = (opened, closed)
    body = [[stamp, merged[stamp][0], merged[stamp][1]] for stamp in sorted(merged)]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body) + "\n")
    print(path.name, len(body))


def main() -> None:
    spot = []
    perp = []
    for month in MONTHS:
        spot.extend(_kline(f"{VISION}/spot/monthly/klines/PEPEUSDT/1d/PEPEUSDT-1d-{month}.zip"))
        perp.extend(
            _kline(
                f"{VISION}/futures/um/monthly/klines/1000PEPEUSDT/1d/1000PEPEUSDT-1d-{month}.zip"
            )
        )
    _write(ROOT / "spot.json", spot)
    _write(ROOT / "perp.json", perp)


if __name__ == "__main__":
    main()
