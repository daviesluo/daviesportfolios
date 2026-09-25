"""Pull the inputs this rule stores. No later year is requested as a signal.

    python3 docs/agents/scripts/fp178/fetch.py
"""

from __future__ import annotations

import csv
import datetime
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

DATA = Path(os.environ.get("FP178_DATA", "/tmp/fp178/data"))
VISION = "https://data.binance.vision"
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp178-research"}


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
    payload = []
    for t in sorted(rows):
        value = rows[t]
        payload.append([t, *value] if isinstance(value, tuple) else [t, value])
    path.write_text(json.dumps(payload, separators=(",", ":")))


def assert_span(rows: dict, end_ms: int, label: str) -> None:
    if not rows or min(rows) != LOOKBACK_MS or max(rows) != end_ms:
        raise SystemExit(label + " does not span the window")
    t = LOOKBACK_MS
    while t <= end_ms:
        if t not in rows:
            raise SystemExit(label + " is missing a day")
        t += c.fp5.DAY_MS


def months(last: str) -> list[str]:
    out = []
    y, m = 2022, 10
    stop_y, stop_m = int(last[:4]), int(last[5:7])
    while (y, m) <= (stop_y, stop_m):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def pull_opens(end_ms: int, indexes: tuple[int, ...]) -> dict[int, tuple]:
    cursor = LOOKBACK_MS
    rows: dict[int, tuple] = {}
    while cursor <= end_ms:
        url = (
            f"{MARKET}/api/v3/klines?symbol=BTCUSDT&interval=1d"
            f"&startTime={cursor}&endTime={end_ms}&limit=1000"
        )
        batch = json.loads(get(url))
        if not batch:
            break
        for kline in batch:
            open_ms = int(kline[0])
            if open_ms < LOOKBACK_MS or open_ms > end_ms:
                continue
            rows[open_ms] = tuple(float(kline[i]) for i in indexes)
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    assert_span(rows, end_ms, "BTCUSDT 1d")
    save("spot1d/BTCUSDT.json", rows)
    return rows


def pull_funding(last_day_ms: int) -> dict[int, tuple]:
    out: dict[int, tuple] = {}
    last = datetime.datetime.fromtimestamp(last_day_ms / 1000, datetime.timezone.utc).strftime("%Y-%m")
    for ym in months(last):
        if ym > "2023-12":
            raise SystemExit("a 2024 funding file was requested")
        url = (
            f"{VISION}/data/futures/um/monthly/fundingRate/BTCUSDT/"
            f"BTCUSDT-fundingRate-{ym}.zip"
        )
        zf = zipfile.ZipFile(io.BytesIO(get(url)))
        for row in csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())):
            if not row or row[0] in ("calc_time", "fundingTime") or len(row) < 3:
                continue
            ts = int(row[0])
            bucket = c.fp5.bucket_8h(ts)
            if bucket is None or bucket < LOOKBACK_MS or bucket > last_day_ms + c.fp5.DAY_MS:
                continue
            if bucket in out:
                raise SystemExit(f"two funding prints share {bucket}")
            out[bucket] = (float(row[2]),)
    if not out:
        raise SystemExit("funding came back empty")
    if any(t >= c.fp5.SCREEN_END_MS + c.fp5.DAY_MS for t in out):
        raise SystemExit("a funding print is past 2024-01-01")
    save("funding/BTCUSDT.json", out)
    return out



def main() -> None:
    if os.environ.get("FP178_OOS"):
        raise SystemExit("this pull does not request a later year")
    spot = pull_opens(c.fp5.SCREEN_END_MS, (1, 2, 3, 4))
    print("fp178 " + f"spot {len(spot)} last {max(spot)}")


if __name__ == "__main__":
    main()

