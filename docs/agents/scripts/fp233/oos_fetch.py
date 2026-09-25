"""Pull the out-of-sample inputs named in the HI10 pre-registration.

Spot runs from 2024-01-01 through the 2026-09-25 open. That last bar is an
exit open. It is not an entry. A bar on 2026-09-26 is not requested. Closes
after 2026-09-16 are not a signal. Refuses to run until the pre-registration's
sha256 matches.

    python3 docs/agents/scripts/fp233/oos_fetch.py
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP233_DATA", "/tmp/fp233/data"))
PREREG = ROOT / "docs/agents/reviews/2026-09-25-fp233-prereg-hi10.md"
SIDECAR = ROOT / "docs/agents/reviews/2026-09-25-fp233-prereg-hi10.sha256"
VISION = "https://data.binance.vision"
LIVE = "https://data-api.binance.vision/api/v3/klines"
UA = {"User-Agent": "daviesportfolios-fp233-research"}

OOS_START = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
EXIT_OPEN = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require_frozen() -> None:
    if sha256(PREREG) != SIDECAR.read_text().strip():
        raise SystemExit("the pre-registration does not match its frozen sha256")


def get(url: str, missing_ok: bool = False) -> bytes | None:
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as res:
                return res.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 404 and missing_ok:
                return None
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


def read_zip_rows(raw: bytes) -> list[list[str]]:
    zf = zipfile.ZipFile(io.BytesIO(raw))
    return list(csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())))


def months() -> list[str]:
    out = []
    y, m = 2024, 1
    while (y, m) <= (2026, 8):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def keep_row(rows: dict[int, tuple], ts: int, open_px: float, close_px: float) -> None:
    if ts < OOS_START or ts > EXIT_OPEN:
        raise SystemExit("a bar outside the frozen window was returned")
    rows[ts] = (open_px, close_px)


def pull_zip(rows: dict[int, tuple], url: str, missing_ok: bool = False) -> bool:
    raw = get(url, missing_ok=missing_ok)
    if raw is None:
        return False
    found = False
    for row in read_zip_rows(raw):
        if not row or row[0] == "open_time":
            continue
        ts = int(row[0])
        if ts >= 10**14:
            ts //= 1000
        if ts < OOS_START or ts > EXIT_OPEN:
            continue
        keep_row(rows, ts, float(row[1]), float(row[4]))
        found = True
    return found


def live_exit_open(rows: dict[int, tuple]) -> None:
    end = EXIT_OPEN + c.fp5.DAY_MS - 1
    page = f"{LIVE}?symbol=BTCUSDT&interval=1d&startTime={EXIT_OPEN}&endTime={end}&limit=5"
    batch = json.loads(get(page))
    kept = None
    for kline in batch:
        open_ms = int(kline[0])
        if open_ms > EXIT_OPEN:
            raise SystemExit("a bar after 2026-09-25 was returned")
        if open_ms == EXIT_OPEN:
            kept = (float(kline[1]), float(kline[4]))
    if kept is None:
        raise SystemExit("the 2026-09-25 open was not returned")
    rows[EXIT_OPEN] = kept


def pull() -> None:
    require_frozen()
    if c.HOLD_DAYS != 8 or c.IDEA != "HI10":
        raise SystemExit("the frozen hold or name moved")
    rows: dict[int, tuple] = {}
    for ym in months():
        url = f"{VISION}/data/spot/monthly/klines/BTCUSDT/1d/BTCUSDT-1d-{ym}.zip"
        if not pull_zip(rows, url):
            raise SystemExit(f"{ym} did not return a spot bar")
    for day in range(1, 26):
        stamp = f"2026-09-{day:02d}"
        url = f"{VISION}/data/spot/daily/klines/BTCUSDT/1d/BTCUSDT-1d-{stamp}.zip"
        missing_ok = day == 25
        if not pull_zip(rows, url, missing_ok=missing_ok) and day != 25:
            raise SystemExit(f"{stamp} did not return a spot bar")
    if EXIT_OPEN not in rows:
        live_exit_open(rows)
    t = OOS_START
    while t <= EXIT_OPEN:
        if t not in rows:
            raise SystemExit("spot is missing a day")
        t += c.fp5.DAY_MS
    if min(rows) != OOS_START or max(rows) != EXIT_OPEN:
        raise SystemExit("spot does not span the frozen window")
    save("oos_spot1d/BTCUSDT.json", rows)
    print(f"fp233 oos spot {len(rows)}", file=sys.stderr)


if __name__ == "__main__":
    pull()
