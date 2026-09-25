"""Download the later-year bars named in the SPQTR pre-registration.

The 2023 screen files are not rewritten. A 404 is a missing month and is
not filled in. No return is computed.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(os.environ.get("FP332_OOS", "/tmp/fp332/oos"))
VISION = "https://data.binance.vision/data"
S3 = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
NS = {"s": "http://s3.amazonaws.com/doc/2006-03-01/"}

# Expiry opens that fall in a published month. 260925 and 261225 do not.
SYMBOLS = (
    "BTCUSDT_240329",
    "BTCUSDT_240628",
    "BTCUSDT_240927",
    "BTCUSDT_241227",
    "BTCUSDT_250328",
    "BTCUSDT_250627",
    "BTCUSDT_250926",
    "BTCUSDT_251226",
    "BTCUSDT_260327",
    "BTCUSDT_260626",
)
SPOT_MONTHS = [f"{year}-{month:02d}" for year in (2024, 2025) for month in range(1, 13)]
SPOT_MONTHS += [f"2026-{month:02d}" for month in range(1, 9)]


def _keys(prefix: str) -> list[str]:
    found = []
    token = None
    while True:
        url = f"{S3}?prefix={prefix}&max-keys=1000"
        if token:
            url += f"&marker={token}"
        req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
        with urllib.request.urlopen(req, timeout=60) as response:
            root = ET.fromstring(response.read())
        batch = [node.text for node in root.findall("s:Contents/s:Key", NS)]
        found.extend(batch)
        if root.find("s:IsTruncated", NS) is None or root.find("s:IsTruncated", NS).text != "true":
            return [key for key in found if key.endswith(".zip")]
        token = batch[-1]


def _kline(url: str) -> list[tuple[int, str, str]]:
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return []
        raise
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
        rows.extend(_kline(f"{VISION}/spot/monthly/klines/BTCUSDT/1d/BTCUSDT-1d-{month}.zip"))
    _write(ROOT / "spot.json", rows)
    for symbol in SYMBOLS:
        prefix = f"data/futures/um/monthly/klines/{symbol}/1d/"
        rows = []
        for key in _keys(prefix):
            rows.extend(_kline(f"https://data.binance.vision/{key}"))
        _write(ROOT / f"{symbol}.json", rows)


if __name__ == "__main__":
    main()
