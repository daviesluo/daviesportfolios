"""Pull the out-of-sample inputs named in the CMF pre-registration.

The coin-margined file runs from 2024-01-01 through the 2026-09-25 open.
That last bar is an exit open. It is not an entry. A bar on 2026-09-26 is
not requested. Spot closes stop on 2026-09-12. A later spot close is not
stored. Refuses to run until the pre-registration's sha256 matches.

    python3 docs/agents/scripts/fp230/oos_fetch.py
"""

from __future__ import annotations

import hashlib
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

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP230_DATA", "/tmp/fp230/data"))
PREREG = ROOT / "docs/agents/reviews/2026-09-25-fp230-prereg-cmf.md"
SIDECAR = ROOT / "docs/agents/reviews/2026-09-25-fp230-prereg-cmf.sha256"
CM_URL = "https://www.binance.com/dapi/v1/klines"
SPOT_URL = "https://data-api.binance.vision/api/v3/klines"
UA = {"User-Agent": "daviesportfolios-fp230-research"}

OOS_START = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
EXIT_OPEN = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)
SPOT_LAST = int(datetime(2026, 9, 12, tzinfo=timezone.utc).timestamp() * 1000)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require_frozen() -> None:
    if sha256(PREREG) != SIDECAR.read_text().strip():
        raise SystemExit("the pre-registration does not match its frozen sha256")


def get(url: str) -> bytes:
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as res:
                return res.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code not in (418, 429, 500, 502, 503) or k + 1 == 6:
                raise
        except Exception as exc:
            last = exc
            if k + 1 == 6:
                raise
        time.sleep(1.0 * (k + 1))
    raise RuntimeError(f"get failed {last}")


def save(rel: str, rows: dict) -> None:
    path = DATA / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([[t, *rows[t]] for t in sorted(rows)], separators=(",", ":")))


def pull_klines(url: str, symbol: str, start_ms: int, end_ms: int, indexes: tuple[int, ...]) -> dict[int, tuple]:
    """Daily bars whose open time is inside the frozen window. Nothing later."""
    if end_ms > EXIT_OPEN:
        raise SystemExit("the pull asks for a bar after 2026-09-25")
    request_end = end_ms + c.fp5.DAY_MS - 1
    cursor = start_ms
    rows: dict[int, tuple] = {}
    while cursor <= end_ms:
        page = (
            f"{url}?symbol={symbol}&interval=1d"
            f"&startTime={cursor}&endTime={request_end}&limit=1500"
        )
        batch = json.loads(get(page))
        if not batch:
            break
        for kline in batch:
            open_ms = int(kline[0])
            if open_ms < start_ms or open_ms > end_ms:
                continue
            if open_ms >= end_ms + c.fp5.DAY_MS:
                raise SystemExit("a bar after the frozen window was returned")
            rows[open_ms] = tuple(float(kline[i]) for i in indexes)
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1500:
            break
    if not rows or min(rows) != start_ms or max(rows) != end_ms:
        raise SystemExit(f"{symbol} does not span the frozen window")
    if any(day > end_ms for day in rows):
        raise SystemExit(f"{symbol} stored a bar after the frozen window")
    return rows


def pull() -> None:
    require_frozen()
    cm = pull_klines(CM_URL, "BTCUSD_PERP", OOS_START, EXIT_OPEN, (1, 4))
    spot = pull_klines(SPOT_URL, "BTCUSDT", OOS_START, SPOT_LAST, (4,))
    t = OOS_START
    while t <= SPOT_LAST:
        if t not in spot:
            raise SystemExit("spot is missing a day")
        t += c.fp5.DAY_MS
    save("oos_cm1d/BTCUSD_PERP.json", cm)
    save("oos_spot1d/BTCUSDT.json", spot)
    print(f"fp230 oos cm {len(cm)} spot {len(spot)}", file=sys.stderr)


if __name__ == "__main__":
    pull()
