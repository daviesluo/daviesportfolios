"""Pull BTCUSDT bars for the fp57 screen.

The 2024-01-01 base volume is stored as 0.

No later year is requested. The 2024-01-01 bar keeps its open. Its signal fields are masked.

    python3 docs/agents/scripts/fp57/fetch.py
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

DATA = Path(os.environ.get("FP57_DATA", "/tmp/fp57/data"))
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp57-research"}

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


def klines(end_ms: int, start_ms: int = LOOKBACK_MS) -> dict[int, tuple]:
    cursor = start_ms
    rows: dict[int, tuple] = {}
    fields = (1, 5)
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
            if open_ms < start_ms:
                continue
            if open_ms > end_ms:
                raise SystemExit(f"a daily bar opened past the screen: {open_ms}")
            open_ = float(k[1])
            if open_ms == end_ms:
                rows[open_ms] = (open_, 0.0)
            else:
                rows[open_ms] = tuple(float(k[i]) for i in fields)
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    return rows


def save(rows: dict[int, tuple], folder: str = "spot1d") -> None:
    out = DATA / folder / "BTCUSDT.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = [[t, *rows[t]] for t in sorted(rows)]
    out.write_text(json.dumps(payload, separators=(",", ":")))


def pull_oos() -> None:
    """Daily bars from 2024-01-01 through the 2026-09-25 open. Called only after the pre-registration is frozen."""
    if not os.environ.get("FP57_OOS"):
        raise SystemExit("the out-of-sample pull is not armed")
    start_ms = c.fp5.SCREEN_END_MS
    end_ms = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)
    rows = klines(end_ms, start_ms)
    if any(t > end_ms for t in rows):
        raise SystemExit("a daily bar opened after 2026-09-25")
    if not rows or min(rows) != start_ms or max(rows) != end_ms:
        raise SystemExit("the daily out-of-sample window is wrong")
    horizon = rows.get(end_ms)
    if horizon is None or horizon[1] != 0:
        raise SystemExit("the 2026-09-25 bar stored a base volume")
    save(rows, "oos_1d")
    print(f"fp57 oos BTCUSDT 1d {len(rows)} first {min(rows)} last {max(rows)}")


def main() -> None:
    if os.environ.get("FP57_OOS"):
        raise SystemExit("this pull does not request a later year")
    rows = klines(c.fp5.SCREEN_END_MS)
    if any(t > c.fp5.SCREEN_END_MS for t in rows):
        raise SystemExit("a daily bar opened after 2024-01-01")
    horizon = rows.get(c.fp5.SCREEN_END_MS)
    if horizon is None or not (horizon[1] == 0):
        raise SystemExit("the 2024-01-01 bar stored a signal field")
    if not rows:
        raise SystemExit("BTCUSDT klines came back empty")
    save(rows)
    print(f"fp57 BTCUSDT 1d {len(rows)} first {min(rows)} last {max(rows)}")


if __name__ == "__main__":
    main()
