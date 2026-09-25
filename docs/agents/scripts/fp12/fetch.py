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
from datetime import datetime, timedelta, timezone
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


def _month(ym: str, end_ms: int | None = None) -> list[list[float]]:
    url = f"{VISION}/BTCDOMUSDT-8h-{ym}.zip"
    request = urllib.request.Request(url, headers={"User-Agent": "fp12-screen"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return []
        raise SystemExit(f"{ym} http {error.code}")
    return _parse_zip(raw, c.fp5.SCREEN_END_MS if end_ms is None else end_ms)


def pull_oos() -> tuple[int, int]:
    """2024–2026 files. Called only after the pre-registration is frozen."""
    if not os.environ.get("FP12_OOS"):
        raise SystemExit("out-of-sample files stay unread until the pre-registration says so")
    oos_end = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)
    dom: list[list[float]] = []
    year, month = 2024, 1
    while (year, month) <= (2026, 8):
        kept = _month(f"{year}-{month:02d}", oos_end)
        if not kept:
            raise SystemExit(f"missing dominance month {year}-{month:02d}")
        dom.extend(kept)
        month += 1
        if month == 13:
            year, month = year + 1, 1
    day = datetime(2026, 9, 1, tzinfo=timezone.utc)
    last = datetime(2026, 9, 24, tzinfo=timezone.utc)
    while day <= last:
        kept = _day(day.strftime("%Y-%m-%d"), oos_end)
        if not kept:
            raise SystemExit(f"missing dominance day {day.date()}")
        dom.extend(kept)
        day += timedelta(days=1)
    book = {int(row[0]): row for row in dom if int(row[0]) < oos_end}
    dom = [book[k] for k in sorted(book)]
    spot = _spot(oos_end)
    FP12.mkdir(parents=True, exist_ok=True)
    (FP12 / "oos_dom8h.json").write_text(json.dumps(dom, separators=(",", ":")))
    (FP12 / "oos_btc8h.json").write_text(json.dumps(spot, separators=(",", ":")))
    return len(dom), len(spot)


def _day(day: str, oos_end: int) -> list[list[float]]:
    url = (
        "https://data.binance.vision/data/futures/um/daily/klines/BTCDOMUSDT/8h/"
        f"BTCDOMUSDT-8h-{day}.zip"
    )
    request = urllib.request.Request(url, headers={"User-Agent": "fp12-oos"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return []
        raise SystemExit(f"{day} http {error.code}")
    return _parse_zip(raw, oos_end)


def _parse_zip(raw: bytes, end_ms: int) -> list[list[float]]:
    zf = zipfile.ZipFile(io.BytesIO(raw))
    kept = []
    for line in zf.read(zf.namelist()[0]).decode().splitlines():
        parts = line.split(",")
        if not parts or not parts[0].isdigit():
            continue
        open_ms = int(parts[0])
        if open_ms >= end_ms:
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


def _spot(oos_end: int) -> list[list[float]]:
    start = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
    rows: dict[int, list[float]] = {}
    cursor = start
    market = "https://data-api.binance.vision"
    while cursor <= oos_end:
        url = (
            f"{market}/api/v3/klines?symbol=BTCUSDT&interval=8h"
            f"&startTime={cursor}&endTime={oos_end}&limit=1000"
        )
        request = urllib.request.Request(url, headers={"User-Agent": "fp12-oos"})
        with urllib.request.urlopen(request, timeout=60) as response:
            batch = json.loads(response.read().decode())
        if not batch:
            break
        for k in batch:
            open_ms = int(k[0])
            if open_ms > oos_end:
                continue
            rows[open_ms] = [
                open_ms, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[7]),
            ]
        nxt = int(batch[-1][0]) + c.fp5.EIGHT_H_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    if oos_end not in rows:
        raise SystemExit("the 2026-09-25 BTC open is missing")
    return [rows[k] for k in sorted(rows)]


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
