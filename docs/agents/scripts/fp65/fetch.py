"""Pull bars for the fp65 screen.

BTCUSDT and ETHUSDT daily bars store the open, the high and the low. The 2024-01-01 high and low are stored equal to the open on both.\n\nNo later year is requested. The close is not stored.

    python3 docs/agents/scripts/fp65/fetch.py
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

DATA = Path(os.environ.get("FP65_DATA", "/tmp/fp65/data"))
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp65-research"}

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
    # fields (1, 2, 3): high and low stored equal to the open
    return (open_, open_, open_)


def main() -> None:
    if os.environ.get("FP65_OOS"):
        raise SystemExit("this pull does not request a later year")
    saved = []
    for symbol in ("BTCUSDT", "ETHUSDT"):
        rows = klines(symbol, "1d", c.fp5.DAY_MS, c.fp5.SCREEN_END_MS, (1, 2, 3))
        if any(t > c.fp5.SCREEN_END_MS for t in rows):
            raise SystemExit("a daily bar opened after 2024-01-01")
        horizon_bar = rows.get(c.fp5.SCREEN_END_MS)
        if horizon_bar is None or horizon_bar != (horizon_bar[0], horizon_bar[0], horizon_bar[0]):
            raise SystemExit(f"the 2024-01-01 bar stored a signal field for {symbol}")
        if not rows:
            raise SystemExit(f"{symbol} klines came back empty")
        save(f"spot1d/{symbol}.json", rows)
        saved.append(f"{symbol} {len(rows)} first {min(rows)} last {max(rows)}")
    print("fp65 " + "; ".join(saved))


if __name__ == "__main__":
    main()
