"""Pull BTC funding and daily opens for the fp103 screen.

Funding stops before 2024-01-01. Daily opens run through 2024-01-14 so a
2-day hold can exit. Those later opens are not a signal. No hourly
price bar is requested. No alt quote is requested.

    python3 docs/agents/scripts/fp103/fetch.py
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

DATA = Path(os.environ.get("FP103_DATA", "/tmp/fp103/data"))
VISION = "https://data.binance.vision"
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp103-research"}


def get(url: str) -> bytes:
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as res:
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


def months() -> list[str]:
    out = []
    y, m = 2022, 10
    while (y, m) <= (2023, 12):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def pull_funding() -> dict[int, float]:
    points: dict[int, float] = {}
    for ym in months():
        url = (
            f"{VISION}/data/futures/um/monthly/fundingRate/BTCUSDT/"
            f"BTCUSDT-fundingRate-{ym}.zip"
        )
        raw = get(url)
        zf = zipfile.ZipFile(io.BytesIO(raw))
        text = zf.read(zf.namelist()[0]).decode()
        for row in csv.DictReader(io.StringIO(text)):
            bucket = c.fp5.bucket_8h(int(row["calc_time"]))
            if bucket is None or bucket < LOOKBACK_MS:
                continue
            if bucket >= c.fp5.SCREEN_END_MS:
                continue
            rate = float(row["last_funding_rate"])
            if bucket in points and abs(points[bucket] - rate) > 1e-12:
                raise SystemExit(f"two funding rates share {bucket}")
            points[bucket] = rate
    if not points:
        raise SystemExit("funding came back empty")
    if max(points) >= c.fp5.SCREEN_END_MS:
        raise SystemExit("a funding print is in 2024")
    out = DATA / "funding" / "BTCUSDT.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = [[t, points[t]] for t in sorted(points)]
    out.write_text(json.dumps(payload, separators=(",", ":")))
    return points


def pull_opens() -> dict[int, tuple]:
    end_ms = c.EXIT_HORIZON_MS
    cursor = LOOKBACK_MS
    rows: dict[int, tuple] = {}
    while cursor <= end_ms:
        url = (
            f"{MARKET}/api/v3/klines?symbol=BTCUSDT&interval=1d"
            f"&startTime={cursor}&endTime={end_ms + c.fp5.DAY_MS - 1}&limit=1000"
        )
        batch = json.loads(get(url))
        if not batch:
            break
        for k in batch:
            if len(k) < 2:
                raise SystemExit("a daily kline is missing the open")
            open_ms = int(k[0])
            if open_ms < LOOKBACK_MS or open_ms > end_ms:
                continue
            rows[open_ms] = (float(k[1]),)
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    if rows.get(end_ms) is None or len(rows[end_ms]) != 1:
        raise SystemExit("the 2024-01-14 open is missing")
    if any(t > end_ms for t in rows):
        raise SystemExit("a daily bar opened after 2024-01-14")
    if not rows:
        raise SystemExit("daily opens came back empty")
    out = DATA / "spot1d" / "BTCUSDT.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = [[t, *rows[t]] for t in sorted(rows)]
    out.write_text(json.dumps(payload, separators=(",", ":")))
    return rows


def main() -> None:
    if os.environ.get("FP103_OOS"):
        raise SystemExit("this pull does not request a later year")
    funding = pull_funding()
    bars = pull_opens()
    print(
        f"fp103 funding {len(funding)} first {min(funding)} last {max(funding)}; "
        f"BTCUSDT 1d {len(bars)} first {min(bars)} last {max(bars)}"
    )


if __name__ == "__main__":
    main()
