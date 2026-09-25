"""Download TRB spot, the TRB perpetual, and the funding file. No return is computed."""

from __future__ import annotations

import json
import os
import urllib.request
import zipfile
from decimal import Decimal
from io import BytesIO
from pathlib import Path

ROOT = Path(os.environ.get("FP334_DATA", "/tmp/fp334/data"))
VISION = "https://data.binance.vision/data"
MONTHS = [f"2023-{m:02d}" for m in range(1, 13)]


def _zip_lines(url: str) -> list[str]:
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
    with urllib.request.urlopen(req, timeout=60) as response:
        payload = response.read()
    with zipfile.ZipFile(BytesIO(payload)) as archive:
        return archive.read(archive.namelist()[0]).decode().splitlines()


def _kline(url: str) -> list[tuple[int, str, str]]:
    rows = []
    for line in _zip_lines(url):
        if not line or not line[0].isdigit():
            continue
        parts = line.split(",")
        stamp = int(float(parts[0]))
        if stamp > 10**14:
            stamp //= 1000
        rows.append((stamp, parts[1], parts[4]))
    return rows


def _funding(url: str) -> list[tuple[int, int, str]]:
    rows = []
    for line in _zip_lines(url):
        if not line or not line[0].isdigit():
            continue
        parts = line.split(",")
        stamp = int(float(parts[0]))
        if stamp > 10**14:
            stamp //= 1000
        Decimal(parts[2])
        rows.append((stamp, int(float(parts[1])), parts[2]))
    return rows


def _write(path: Path, body: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body) + "\n")
    print(path.name, len(body))


def main() -> None:
    spot: dict[int, tuple[str, str]] = {}
    perp: dict[int, tuple[str, str]] = {}
    funding: dict[int, tuple[int, str]] = {}
    for month in MONTHS:
        for stamp, opened, closed in _kline(
            f"{VISION}/spot/monthly/klines/TRBUSDT/1h/TRBUSDT-1h-{month}.zip"
        ):
            spot[stamp] = (opened, closed)
        for stamp, opened, closed in _kline(
            f"{VISION}/futures/um/monthly/klines/TRBUSDT/1h/TRBUSDT-1h-{month}.zip"
        ):
            perp[stamp] = (opened, closed)
        for stamp, hours, rate in _funding(
            f"{VISION}/futures/um/monthly/fundingRate/TRBUSDT/TRBUSDT-fundingRate-{month}.zip"
        ):
            funding[stamp] = (hours, rate)
    _write(ROOT / "spot.json", [[stamp, spot[stamp][0], spot[stamp][1]] for stamp in sorted(spot)])
    _write(ROOT / "perp.json", [[stamp, perp[stamp][0], perp[stamp][1]] for stamp in sorted(perp)])
    _write(
        ROOT / "funding.json",
        [[stamp, funding[stamp][0], funding[stamp][1]] for stamp in sorted(funding)],
    )


if __name__ == "__main__":
    main()
