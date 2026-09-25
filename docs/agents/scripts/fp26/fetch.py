"""Pull BTCUSDT daily opens, highs, lows and closes for the fp26 screen.

No later year is requested. The 2024-01-01 bar keeps its open, because that
open can be an exit, and stores that same open in the other three fields.
Its high, low and close are not read. A bar opened after that day is a bug.
Volume is not stored.

    python3 docs/agents/scripts/fp26/fetch.py
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

DATA = Path(os.environ.get("FP26_DATA", "/tmp/fp26/data"))
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp26-research"}


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
                raise RuntimeError("BTCUSDT daily klines were not found") from exc
            if exc.code not in (418, 429, 500, 502, 503) or k + 1 == 6:
                raise
        except Exception as exc:
            last = exc
            if k + 1 == 6:
                raise
        time.sleep(1.0 * (k + 1))
    raise RuntimeError(f"get failed {last}")


def pull_oos() -> None:
    """Daily bars from 2024-01-01 through the 2026-09-25 open. Called only after the pre-registration is frozen."""
    if not os.environ.get("FP26_OOS"):
        raise SystemExit("the out-of-sample pull is not armed")
    start_ms = c.fp5.SCREEN_END_MS
    end_ms = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)
    cursor = start_ms
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
            if len(k) < 5:
                raise SystemExit("a daily kline is missing a price")
            open_ms = int(k[0])
            if open_ms < start_ms:
                continue
            if open_ms > end_ms:
                raise SystemExit(f"a bar opened after 2026-09-25: {open_ms}")
            open_ = float(k[1])
            if open_ms == end_ms:
                rows[open_ms] = (open_, open_, open_, open_)
            else:
                rows[open_ms] = (open_, float(k[2]), float(k[3]), float(k[4]))
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    if not rows or max(rows) != end_ms:
        raise SystemExit("the 2026-09-25 open was not in the pull")
    out = DATA / "oos_1d" / "BTCUSDT.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = [[t, *rows[t]] for t in sorted(rows)]
    out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"fp26 oos BTCUSDT 1d bars {len(rows)} first {min(rows)} last {max(rows)}")


def main() -> None:
    if os.environ.get("FP26_OOS"):
        pull_oos()
        return
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
            if len(k) < 5:
                raise SystemExit("a daily kline is missing a price")
            open_ms = int(k[0])
            if open_ms < LOOKBACK_MS:
                continue
            if open_ms > end_ms:
                raise SystemExit(f"a bar opened after 2024-01-01: {open_ms}")
            open_ = float(k[1])
            if open_ms == end_ms:
                rows[open_ms] = (open_, open_, open_, open_)
            else:
                rows[open_ms] = (open_, float(k[2]), float(k[3]), float(k[4]))
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    if not rows:
        raise SystemExit("BTCUSDT daily klines came back empty")
    if max(rows) > end_ms:
        raise SystemExit("a daily bar opened after 2024-01-01")
    out = DATA / "spot1d" / "BTCUSDT.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = [[t, *rows[t]] for t in sorted(rows)]
    out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"fp26 BTCUSDT 1d bars {len(rows)} first {min(rows)} last {max(rows)}")


if __name__ == "__main__":
    main()
