"""Pull daily bars for the fp36 screen.

A bar is the open, high and low. The 2024-01-01 high and low are stored as the open, so that bar has no range.

No later year is requested. The 2024-01-01 bar keeps its open, because that
open can be an exit, and the signal fields on that bar are masked. A later
open is a bug.

    python3 docs/agents/scripts/fp36/fetch.py
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

DATA = Path(os.environ.get("FP36_DATA", "/tmp/fp36/data"))
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp36-research"}

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


def klines(symbol: str, end_ms: int) -> dict[int, tuple]:
    cursor = LOOKBACK_MS
    rows: dict[int, tuple] = {}
    fields = (1, 2, 3)
    while cursor <= end_ms:
        url = (
            f"{MARKET}/api/v3/klines?symbol={symbol}&interval=1d"
            f"&startTime={cursor}&endTime={end_ms}&limit=1000"
        )
        batch = json.loads(get(url))
        if not batch:
            break
        for k in batch:
            if len(k) <= max(fields):
                raise SystemExit(f"a daily kline is missing a field: {symbol}")
            open_ms = int(k[0])
            if open_ms < LOOKBACK_MS:
                continue
            if open_ms > end_ms:
                raise SystemExit(f"a daily bar opened past the screen: {open_ms}")
            open_ = float(k[1])
            if open_ms == end_ms:
                rows[open_ms] = (open_, open_, open_)
            else:
                rows[open_ms] = tuple(float(k[i]) for i in fields)
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    return rows


def save(symbol: str, rows: dict[int, tuple]) -> None:
    out = DATA / "spot1d" / f"{symbol}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = [[t, *rows[t]] for t in sorted(rows)]
    out.write_text(json.dumps(payload, separators=(",", ":")))


def main() -> None:
    if os.environ.get("FP36_OOS"):
        raise SystemExit("this pull does not request a later year")
    for symbol in ("BTCUSDT",):
        rows = klines(symbol, c.fp5.SCREEN_END_MS)
        if any(t > c.fp5.SCREEN_END_MS for t in rows):
            raise SystemExit(f"a daily bar opened after 2024-01-01: {symbol}")
        horizon = rows.get(c.fp5.SCREEN_END_MS)
        if horizon is None or not (horizon[0] == horizon[1] == horizon[2]):
            raise SystemExit(f"the 2024-01-01 bar stored a signal field: {symbol}")
        if not rows:
            raise SystemExit(f"{symbol} klines came back empty")
        save(symbol, rows)
        print(f"fp36 {symbol} 1d {len(rows)} first {min(rows)} last {max(rows)}")


if __name__ == "__main__":
    main()
