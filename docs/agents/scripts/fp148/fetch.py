"""Pull the spot close and the USDT perpetual close. The fill uses the spot open. No hourly price bar is requested.

    python3 docs/agents/scripts/fp148/fetch.py
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

DATA = Path(os.environ.get("FP148_DATA", "/tmp/fp148/data"))
VISION = "https://data.binance.vision"
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp148-research"}
EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)


def get(url: str, missing_ok: bool = False) -> bytes | None:
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as res:
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


def stamp_ms(text: str, fmt: str) -> int:
    parsed = datetime.datetime.strptime(text, fmt).replace(tzinfo=datetime.timezone.utc)
    return int((parsed - EPOCH).total_seconds() * 1000)


def months() -> list[str]:
    out = []
    y, m = 2022, 10
    while (y, m) <= (2023, 12):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def save(rel: str, rows: dict) -> None:
    path = DATA / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = []
    for t in sorted(rows):
        value = rows[t]
        payload.append([t, *value] if isinstance(value, tuple) else [t, value])
    path.write_text(json.dumps(payload, separators=(",", ":")))


def assert_full(rows: dict, end_ms: int, label: str) -> None:
    if not rows:
        raise SystemExit(label + " came back empty")
    if min(rows) != LOOKBACK_MS:
        raise SystemExit(label + " does not start on 2022-10-01")
    if max(rows) != end_ms:
        raise SystemExit(label + " stops on the wrong day")
    t = LOOKBACK_MS
    while t <= end_ms:
        if t not in rows:
            raise SystemExit(label + " is missing a day")
        t += c.fp5.DAY_MS


def pull_spot_open() -> dict[int, tuple]:
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
        for k in batch:
            if len(k) < 2:
                raise SystemExit("a daily kline is missing the open")
            open_ms = int(k[0])
            if open_ms < LOOKBACK_MS:
                continue
            if open_ms > end_ms:
                raise SystemExit(f"a daily bar opened past the screen: {open_ms}")
            rows[open_ms] = (float(k[1]),)
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    assert_full(rows, end_ms, "BTCUSDT 1d")
    if any(len(bar) != 1 for bar in rows.values()):
        raise SystemExit("a spot bar stored a signal field")
    save("spot1d/BTCUSDT.json", rows)
    return rows

def pull_signal() -> dict[int, tuple]:
    spot: dict[int, float] = {}
    end_ms = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    cursor = LOOKBACK_MS
    while cursor <= end_ms:
        url = (
            f"{MARKET}/api/v3/klines?symbol=BTCUSDT&interval=1d"
            f"&startTime={cursor}&endTime={end_ms}&limit=1000"
        )
        batch = json.loads(get(url))
        if not batch:
            break
        for k in batch:
            if len(k) < 5:
                raise SystemExit("a spot kline is missing the close")
            open_ms = int(k[0])
            if LOOKBACK_MS <= open_ms <= end_ms:
                close = float(k[4])
                if close <= 0:
                    raise SystemExit("a spot close is not positive")
                spot[open_ms] = close
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    um: dict[int, float] = {}
    for ym in months():
        if ym >= "2024-01":
            raise SystemExit("a 2024 perpetual file was requested")
        url = f"{VISION}/data/futures/um/monthly/klines/BTCUSDT/1d/BTCUSDT-1d-{ym}.zip"
        zf = zipfile.ZipFile(io.BytesIO(get(url)))
        for row in csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())):
            if not row or row[0] == "open_time" or len(row) < 5:
                continue
            open_ms = int(row[0])
            if open_ms < LOOKBACK_MS or open_ms > end_ms:
                continue
            close = float(row[4])
            if close <= 0:
                raise SystemExit("a perpetual close is not positive")
            if open_ms in um:
                raise SystemExit(f"two perpetual bars share {open_ms}")
            um[open_ms] = close
    out = {day: (spot[day], um[day]) for day in spot if day in um}
    assert_full(out, end_ms, "signal")
    save("close/both.json", out)
    return out

def main() -> None:
    if os.environ.get("FP148_OOS"):
        raise SystemExit("this pull does not request a later year")
    signal = pull_signal()
    bars = pull_spot_open()
    print(
        "fp148 "
        + f"signal {len(signal)} first {min(signal)} last {max(signal)}"
        + "; "
        + f"BTCUSDT 1d {len(bars)} first {min(bars)} last {max(bars)}"
    )


if __name__ == "__main__":
    main()
