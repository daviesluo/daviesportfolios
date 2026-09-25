"""Pull BTCUSDT bars for the fp48 screen.

A bar is the open, the quote volume and the trade count. The 2024-01-01 quote and trade count are stored as 0.

No later year is requested. The 2024-01-01 bar keeps its open. Its signal fields are masked.

    python3 docs/agents/scripts/fp48/fetch.py
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

DATA = Path(os.environ.get("FP48_DATA", "/tmp/fp48/data"))
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp48-research"}


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

def klines(end_ms: int) -> dict[int, tuple]:
    cursor = LOOKBACK_MS
    rows: dict[int, tuple] = {}
    fields = (1, 7, 8)
    while cursor <= end_ms:
        url = (
            f"{MARKET}/api/v3/klines?symbol=BTCUSDT&interval=1d"
            f"&startTime={cursor}&endTime={end_ms}&limit=1000"
        )
        batch = json.loads(get(url))
        if not batch:
            break
        for k in batch:
            if len(k) <= max(fields):
                raise SystemExit("a daily kline is missing a field")
            open_ms = int(k[0])
            if open_ms < LOOKBACK_MS:
                continue
            if open_ms > end_ms:
                raise SystemExit(f"a daily bar opened past the screen: {open_ms}")
            open_ = float(k[1])
            if open_ms == end_ms:
                rows[open_ms] = (open_, 0.0, 0.0)
            else:
                rows[open_ms] = tuple(float(k[i]) for i in fields)
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    return rows


def save(rows: dict[int, tuple]) -> None:
    out = DATA / "spot1d" / "BTCUSDT.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = [[t, *rows[t]] for t in sorted(rows)]
    out.write_text(json.dumps(payload, separators=(",", ":")))


def main() -> None:
    if os.environ.get("FP48_OOS"):
        raise SystemExit("this pull does not request a later year")
    rows = klines(c.fp5.SCREEN_END_MS)
    if any(t > c.fp5.SCREEN_END_MS for t in rows):
        raise SystemExit("a daily bar opened after 2024-01-01")
    horizon = rows.get(c.fp5.SCREEN_END_MS)
    if horizon is None or not (horizon[1] == 0 and horizon[2] == 0):
        raise SystemExit("the 2024-01-01 bar stored a signal field")
    if not rows:
        raise SystemExit("BTCUSDT klines came back empty")
    save(rows)
    print(f"fp48 BTCUSDT 1d {len(rows)} first {min(rows)} last {max(rows)}")


if __name__ == "__main__":
    main()
