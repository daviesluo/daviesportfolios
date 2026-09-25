"""Pull BTCUSDT daily opens and closes for the fp29 screen.

No later year is requested. The 2024-01-01 bar keeps its open, because that
open can be an exit, and stores the same number in place of the close. A
later open is a bug. High, low and volume are not stored.

    python3 docs/agents/scripts/fp29/fetch.py
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

DATA = Path(os.environ.get("FP29_DATA", "/tmp/fp29/data"))
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp29-research"}


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
                raise SystemExit(f"a daily bar opened past the screen: {open_ms}")
            open_ = float(k[1])
            if open_ms == end_ms:
                rows[open_ms] = (open_, open_)
            else:
                rows[open_ms] = (open_, float(k[4]))
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    return rows


def main() -> None:
    if os.environ.get("FP29_OOS"):
        raise SystemExit("this pull does not request a later year")
    daily = klines(c.fp5.SCREEN_END_MS)
    if any(t > c.fp5.SCREEN_END_MS for t in daily):
        raise SystemExit("a daily bar opened after 2024-01-01")
    horizon = daily.get(c.fp5.SCREEN_END_MS)
    if horizon is None or horizon[0] != horizon[1]:
        raise SystemExit("the 2024-01-01 bar stored a close")
    if not daily:
        raise SystemExit("BTCUSDT klines came back empty")
    out = DATA / "spot1d" / "BTCUSDT.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = [[t, *daily[t]] for t in sorted(daily)]
    out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"fp29 BTCUSDT 1d {len(daily)} first {min(daily)} last {max(daily)}")


if __name__ == "__main__":
    main()
