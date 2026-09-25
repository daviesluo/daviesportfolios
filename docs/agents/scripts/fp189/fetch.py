"""Pull the inputs this rule stores. No later year is requested as a signal.

    python3 docs/agents/scripts/fp189/fetch.py
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

DATA = Path(os.environ.get("FP189_DATA", "/tmp/fp189/data"))
VISION = "https://data.binance.vision"
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp189-research"}


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
    payload = []
    for t in sorted(rows):
        value = rows[t]
        payload.append([t, *value] if isinstance(value, tuple) else [t, value])
    path.write_text(json.dumps(payload, separators=(",", ":")))


def assert_spot(rows: dict, end_ms: int) -> None:
    if not rows or min(rows) != LOOKBACK_MS or max(rows) != end_ms:
        raise SystemExit("BTCUSDT 1d does not span the window")
    t = LOOKBACK_MS
    while t <= end_ms:
        if t not in rows:
            raise SystemExit("BTCUSDT 1d is missing a day")
        t += c.fp5.DAY_MS


def pull_spot(indexes: tuple[int, ...]) -> dict[int, tuple]:
    end_ms = c.fp5.SCREEN_END_MS
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
    assert_spot(rows, end_ms)
    save("spot1d/BTCUSDT.json", rows)
    return rows


def months() -> list[str]:
    out = []
    y, m = 2022, 12
    while (y, m) <= (2023, 12):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def read_zip_rows(url: str) -> list[list[str]]:
    raw = get(url)
    zf = zipfile.ZipFile(io.BytesIO(raw))
    return list(csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())))


def keep_signal_day(ts: int) -> bool:
    if ts > c.SIGNAL_LAST_MS:
        return False
    if ts >= c.fp5.SCREEN_END_MS:
        raise SystemExit("a 2024 bar was requested")
    return True

def pull_funding(kind: str, symbol: str, rel: str) -> dict[int, float]:
    rows: dict[int, float] = {}
    last_bucket = c.SIGNAL_LAST_MS + 2 * c.fp5.EIGHT_H_MS
    for ym in months():
        url = (
            f"{VISION}/data/futures/{kind}/monthly/fundingRate/{symbol}/"
            f"{symbol}-fundingRate-{ym}.zip"
        )
        for row in read_zip_rows(url):
            if not row or row[0] in ("calc_time", "fundingTime") or len(row) < 3:
                continue
            bucket = c.fp5.bucket_8h(int(row[0]))
            if bucket is None:
                continue
            if bucket > last_bucket:
                continue
            if bucket >= c.fp5.SCREEN_END_MS:
                raise SystemExit("a funding print is in 2024")
            if bucket in rows:
                raise SystemExit(f"two funding prints share {bucket}")
            rows[bucket] = float(row[2])
    if not rows:
        raise SystemExit(symbol + " funding came back empty")
    save(rel, rows)
    return rows


def main() -> None:
    if os.environ.get("FP189_OOS"):
        raise SystemExit("this pull does not request a later year")
    spot = pull_spot((1, 4))
    um = pull_funding("um", "BTCUSDT", "funding/BTCUSDT.json")
    cm = pull_funding("cm", "BTCUSD_PERP", "funding/BTCUSD_PERP.json")
    print("fp189 " + f"spot {len(spot)} last {max(spot)} um {len(um)} cm {len(cm)}")


if __name__ == "__main__":
    main()
