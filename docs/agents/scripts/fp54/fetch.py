"""Pull BTCUSDT bars for the fp54 screen.

Hourly bars store only the fields this rule reads. The daily file stores opens.

No later year is requested. Hourly bars stop before the 2024-01-01 open. The daily file keeps that open because it can be an exit. A later open is a bug.

    python3 docs/agents/scripts/fp54/fetch.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

DATA = Path(os.environ.get("FP54_DATA", "/tmp/fp54/data"))
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp54-research"}

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
                raise RuntimeError(f"klines were not found: {{url}}") from exc
            if exc.code not in (418, 429, 500, 502, 503) or k + 1 == 6:
                raise
        except Exception as exc:
            last = exc
            if k + 1 == 6:
                raise
        time.sleep(1.0 * (k + 1))
    raise RuntimeError(f"get failed {{last}}")


def klines(interval: str, step: int, end_ms: int, fields: tuple[int, ...]) -> dict[int, tuple]:
    cursor = LOOKBACK_MS
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
            if open_ms < LOOKBACK_MS:
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


def main() -> None:
    if os.environ.get("FP54_OOS"):
        raise SystemExit("this pull does not request a later year")
    hour_end = c.fp5.SCREEN_END_MS - 1
    hourly = klines("1h", c.HOUR_MS, hour_end, (7,))
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
        f"fp54 BTCUSDT 1h {len(hourly)} first {min(hourly)} last {max(hourly)}; "
        f"1d {len(daily)} first {min(daily)} last {max(daily)}"
    )


if __name__ == "__main__":
    main()
