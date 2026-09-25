"""Download the Binance vision bars this rule reads. No return is computed."""

from __future__ import annotations

import json
import os
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

ROOT = Path(os.environ.get("FP332_DATA", "/tmp/fp332/data"))
VISION = "https://data.binance.vision/data"

SPOT_MONTHS = ["2022-12"] + [f"2023-{m:02d}" for m in range(1, 13)] + ["2024-03"]
FUTURES = {
    "BTCUSDT_230331": ["2022-12", "2023-01", "2023-02", "2023-03"],
    "BTCUSDT_230630": ["2023-03", "2023-04", "2023-05", "2023-06"],
    "BTCUSDT_230929": ["2023-06", "2023-07", "2023-08", "2023-09", "2023-10", "2023-11"],
    "BTCUSDT_231229": ["2023-08", "2023-09", "2023-10", "2023-11", "2023-12"],
    "BTCUSDT_240329": ["2023-09", "2023-10", "2023-11", "2023-12", "2024-03"],
}


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
    rows = []
    for month in SPOT_MONTHS:
        url = f"{VISION}/spot/monthly/klines/BTCUSDT/1d/BTCUSDT-1d-{month}.zip"
        rows.extend(_kline(url))
    _write(ROOT / "spot.json", rows)
    for symbol, months in FUTURES.items():
        rows = []
        for month in months:
            url = f"{VISION}/futures/um/monthly/klines/{symbol}/1d/{symbol}-1d-{month}.zip"
            rows.extend(_kline(url))
        _write(ROOT / f"{symbol}.json", rows)


if __name__ == "__main__":
    main()
