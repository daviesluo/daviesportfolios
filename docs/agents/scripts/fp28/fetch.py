"""Pull BTCUSDT hourly opens, closes and quote volume, and daily opens.

No later year is requested. Hourly bars stop before the 2024-01-01 open.
The daily file keeps that open because it can be the exit of the last 2023
entry. A later open is a bug. High, low, trade count and taker volume are
not stored.

    python3 docs/agents/scripts/fp28/fetch.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

DATA = Path(os.environ.get("FP28_DATA", "/tmp/fp28/data"))
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp28-research"}


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
                raise RuntimeError(f"klines were not found: {url}") from exc
            if exc.code not in (418, 429, 500, 502, 503) or k + 1 == 6:
                raise
        except Exception as exc:
            last = exc
            if k + 1 == 6:
                raise
        time.sleep(1.0 * (k + 1))
    raise RuntimeError(f"get failed {last}")


def klines(
    interval: str, step: int, end_ms: int, fields: tuple[int, ...], start_ms: int = LOOKBACK_MS,
) -> dict[int, tuple]:
    cursor = start_ms
    rows: dict[int, tuple] = {}
    while cursor <= end_ms:
        url = (
            f"{MARKET}/api/v3/klines?symbol=BTCUSDT&interval={interval}"
            f"&startTime={cursor}&endTime={end_ms}&limit=1000"
        )
        batch = json.loads(get(url))
        if not batch:
            break
        for k in batch:
            if len(k) <= max(fields):
                raise SystemExit(f"a {interval} kline is missing a field")
            open_ms = int(k[0])
            if open_ms < start_ms:
                continue
            if open_ms > end_ms:
                raise SystemExit(f"a {interval} bar opened past the screen: {open_ms}")
            rows[open_ms] = tuple(float(k[i]) for i in fields)
        nxt = int(batch[-1][0]) + step
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    return rows


def save(name: str, rows: dict[int, tuple]) -> None:
    out = DATA / name
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = [[t, *rows[t]] for t in sorted(rows)]
    out.write_text(json.dumps(payload, separators=(",", ":")))


def pull_oos() -> None:
    """Bars from 2024-01-01 through the 2026-09-25 open. Called only after the pre-registration is frozen."""
    if not os.environ.get("FP28_OOS"):
        raise SystemExit("the out-of-sample pull is not armed")
    start_ms = c.fp5.SCREEN_END_MS
    end_ms = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)
    hourly = klines("1h", c.HOUR_MS, end_ms - 1, (1, 4, 7), start_ms)
    daily = klines("1d", c.fp5.DAY_MS, end_ms, (1,), start_ms)
    if any(t >= end_ms for t in hourly):
        raise SystemExit("an hourly bar opened on or after 2026-09-25")
    if not hourly or min(hourly) != start_ms or max(hourly) != end_ms - c.HOUR_MS:
        raise SystemExit("the hourly out-of-sample window is wrong")
    if not daily or min(daily) != start_ms or max(daily) != end_ms:
        raise SystemExit("the daily out-of-sample window is wrong")
    if any(len(bar) != 1 for bar in daily.values()):
        raise SystemExit("a daily bar stored more than its open")
    save("oos_1h/BTCUSDT.json", hourly)
    save("oos_1d/BTCUSDT.json", daily)
    print(
        f"fp28 oos BTCUSDT 1h {len(hourly)} first {min(hourly)} last {max(hourly)}; "
        f"1d {len(daily)} first {min(daily)} last {max(daily)}"
    )


def main() -> None:
    if os.environ.get("FP28_OOS"):
        raise SystemExit("this pull does not request a later year")
    hour_end = c.fp5.SCREEN_END_MS - 1
    hourly = klines("1h", c.HOUR_MS, hour_end, (1, 4, 7))
    if any(t >= c.fp5.SCREEN_END_MS for t in hourly):
        raise SystemExit("an hourly bar opened on or after 2024-01-01")
    daily = klines("1d", c.fp5.DAY_MS, c.fp5.SCREEN_END_MS, (1,))
    if any(t > c.fp5.SCREEN_END_MS for t in daily):
        raise SystemExit("a daily bar opened after 2024-01-01")
    if not hourly or not daily:
        raise SystemExit("BTCUSDT klines came back empty")
    save("spot1h/BTCUSDT.json", hourly)
    save("spot1d/BTCUSDT.json", daily)
    print(
        f"fp28 BTCUSDT 1h {len(hourly)} first {min(hourly)} last {max(hourly)}; "
        f"1d {len(daily)} first {min(daily)} last {max(daily)}"
    )


if __name__ == "__main__":
    main()
