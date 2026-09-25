"""Pull BTCUSDT daily bars for the fp19 screen.

No later year is requested. The 2024-01-01 open is kept because it can be
the exit of the last 2023 entry. A bar opened after that is a bug. Quote
volume and the trade count are not stored.

    python3 docs/agents/scripts/fp19/fetch.py
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

DATA = Path(os.environ.get("FP19_DATA", "/tmp/fp19/data"))
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp19-research"}


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


def main() -> None:
    if os.environ.get("FP19_OOS"):
        raise SystemExit("this pull does not request a later year")
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
            open_ms = int(k[0])
            if open_ms < LOOKBACK_MS:
                continue
            if open_ms > end_ms:
                raise SystemExit(f"a bar opened after 2024-01-01: {open_ms}")
            rows[open_ms] = (float(k[1]), float(k[2]), float(k[3]), float(k[4]))
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
    print(f"fp19 BTCUSDT 1d bars {len(rows)} first {min(rows)} last {max(rows)}")


if __name__ == "__main__":
    main()
