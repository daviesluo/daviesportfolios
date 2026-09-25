"""Pull bars for the fp62 screen.

The 2024-01-01 low and close are stored equal to the open.\n\nNo later year is requested. The 2024-01-01 bar keeps its open. Its signal fields are masked.

    python3 docs/agents/scripts/fp62/fetch.py
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

DATA = Path(os.environ.get("FP62_DATA", "/tmp/fp62/data"))
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp62-research"}

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
                raise RuntimeError("klines were not found: " + url) from exc
            if exc.code not in (418, 429, 500, 502, 503) or k + 1 == 6:
                raise
        except Exception as exc:
            last = exc
            if k + 1 == 6:
                raise
        time.sleep(1.0 * (k + 1))
    raise RuntimeError(f"get failed {last}")


def klines(symbol: str, interval: str, step: int, end_ms: int, fields: tuple[int, ...]) -> dict[int, tuple]:
    cursor = LOOKBACK_MS
    rows: dict[int, tuple] = {}
    while cursor <= end_ms:
        url = (
            f"{MARKET}/api/v3/klines?symbol={symbol}&interval={interval}"
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
            open_ = float(k[1])
            if interval == "1d" and open_ms == c.fp5.SCREEN_END_MS:
                rows[open_ms] = horizon(open_, fields)
            else:
                rows[open_ms] = tuple(float(k[i]) for i in fields)
        nxt = int(batch[-1][0]) + step
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    return rows


def save(folder: str, rows: dict[int, tuple]) -> None:
    out = DATA / folder
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = [[t, *rows[t]] for t in sorted(rows)]
    out.write_text(json.dumps(payload, separators=(",", ":")))

def horizon(open_: float, fields: tuple[int, ...]) -> tuple:
    # fields (1, 3, 4): low and close stored equal to the open
    return (open_, open_, open_)


def main() -> None:
    if os.environ.get("FP62_OOS"):
        raise SystemExit("this pull does not request a later year")
    rows = klines("BTCUSDT", "1d", c.fp5.DAY_MS, c.fp5.SCREEN_END_MS, (1, 3, 4))
    if any(t > c.fp5.SCREEN_END_MS for t in rows):
        raise SystemExit("a daily bar opened after 2024-01-01")
    horizon_bar = rows.get(c.fp5.SCREEN_END_MS)
    if horizon_bar is None or horizon_bar != (horizon_bar[0], horizon_bar[0], horizon_bar[0]):
        raise SystemExit("the 2024-01-01 bar stored a signal field")
    if not rows:
        raise SystemExit("BTCUSDT klines came back empty")
    save("spot1d/BTCUSDT.json", rows)
    print(f"fp62 BTCUSDT 1d {len(rows)} first {min(rows)} last {max(rows)}")


if __name__ == "__main__":
    main()
