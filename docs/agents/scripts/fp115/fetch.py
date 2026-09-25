"""Pull the public series the fp115 screen is allowed to see.

The signal is spot quote volume over the USDT perpetual's quote volume. The trade count is not stored. The 2024-01-01 quote is stored as zero. The perpetual stops before 2024-01-01. No hourly price bar is requested. No funding print is requested.
No alt quote is requested. No bookDepth file is requested. Count long/short
and taker columns are not stored.

    python3 docs/agents/scripts/fp115/fetch.py
"""

from __future__ import annotations

import csv
import datetime
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

DATA = Path(os.environ.get("FP115_DATA", "/tmp/fp115/data"))
VISION = "https://data.binance.vision"
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp115-research"}
SPOT_FIELDS = (1, 7)
EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
METRICS_HEADER = [
    "create_time",
    "symbol",
    "sum_open_interest",
    "sum_open_interest_value",
    "count_toptrader_long_short_ratio",
    "sum_toptrader_long_short_ratio",
    "count_long_short_ratio",
    "sum_taker_long_short_vol_ratio",
]


def get(url: str, missing_ok: bool = False) -> bytes | None:
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 404:
                if missing_ok:
                    return None
                raise RuntimeError("a file was not found: " + url) from exc
            if exc.code not in (418, 429, 500, 502, 503) or k + 1 == 6:
                raise
        except Exception as exc:
            last = exc
            if k + 1 == 6:
                raise
        time.sleep(1.0 * (k + 1))
    raise RuntimeError(f"get failed {last}")


def stamp_ms(text: str, fmt: str) -> int:
    parsed = datetime.datetime.strptime(text, fmt).replace(tzinfo=datetime.timezone.utc)
    return int((parsed - EPOCH).total_seconds() * 1000)


def months() -> list[str]:
    out = []
    y, m = 2022, 10
    while (y, m) <= (2023, 12):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def metric_days() -> list[str]:
    out = []
    t = LOOKBACK_MS
    last = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    while t <= last:
        out.append(
            datetime.datetime.fromtimestamp(t / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")
        )
        t += c.fp5.DAY_MS
    return out


def num(cell: str) -> float | None:
    cell = cell.strip()
    if cell == "":
        return None
    return float(cell)


def save(rel: str, rows: dict) -> None:
    path = DATA / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = []
    for t in sorted(rows):
        value = rows[t]
        if isinstance(value, tuple):
            payload.append([t, *value])
        else:
            payload.append([t, value])
    path.write_text(json.dumps(payload, separators=(",", ":")))


def assert_span(rows: dict, end_ms: int, label: str) -> None:
    if not rows:
        raise SystemExit(label + " came back empty")
    if min(rows) != LOOKBACK_MS:
        raise SystemExit(label + " does not start on 2022-10-01")
    if max(rows) != end_ms:
        raise SystemExit(label + " stops on the wrong day")
    if any(t > end_ms for t in rows):
        raise SystemExit(label + " goes past its stop")
    t = LOOKBACK_MS
    while t <= end_ms:
        if t not in rows:
            raise SystemExit(label + " is missing a day")
        t += c.fp5.DAY_MS

def pull_spot() -> dict[int, tuple]:
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
            if len(k) <= max(SPOT_FIELDS):
                raise SystemExit("a daily kline is missing a field")
            open_ms = int(k[0])
            if open_ms < LOOKBACK_MS:
                continue
            if open_ms > end_ms:
                raise SystemExit(f"a daily bar opened past the screen: {open_ms}")
            open_ = float(k[1])
            if open_ms == end_ms:
                rows[open_ms] = (open_, 0.0)
            else:
                rows[open_ms] = tuple(float(k[i]) for i in SPOT_FIELDS)
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    assert_span(rows, end_ms, "BTCUSDT 1d")
    horizon = rows[end_ms]
    if len(horizon) != 2 or horizon[1] != 0.0:
        raise SystemExit("the horizon stored a signal field")
    save("spot1d/BTCUSDT.json", rows)
    return rows

UM_INDEX = 7
UM_REL = "um/quote.json"


def pull_vision(market: str, symbol: str, index: int, rel: str, unit_check: bool) -> dict[int, float]:
    ym_list = months()
    if ym_list[0] != "2022-10" or ym_list[-1] != "2023-12":
        raise SystemExit("the kline window moved")
    out: dict[int, float] = {}
    for ym in ym_list:
        if ym >= "2024-01":
            raise SystemExit("a 2024 perpetual file was requested")
        url = (
            f"{VISION}/data/futures/{market}/monthly/klines/{symbol}/1d/"
            f"{symbol}-1d-{ym}.zip"
        )
        raw = get(url)
        if raw is None:
            raise SystemExit("a perpetual month is missing")
        zf = zipfile.ZipFile(io.BytesIO(raw))
        names = zf.namelist()
        if len(names) != 1:
            raise SystemExit(ym + " zip has the wrong members")
        reader = csv.reader(io.StringIO(zf.read(names[0]).decode()))
        for row in reader:
            if not row or row[0] == "open_time":
                continue
            if len(row) <= index:
                raise SystemExit("a perpetual kline is short")
            open_ms = int(row[0])
            if open_ms > 10**14:
                raise SystemExit("open_time is not milliseconds")
            if open_ms < LOOKBACK_MS:
                continue
            if open_ms >= c.fp5.SCREEN_END_MS:
                raise SystemExit("a perpetual bar is in 2024")
            value = float(row[index])
            if open_ms in out:
                raise SystemExit(f"two perpetual bars share {open_ms}")
            out[open_ms] = value
    stop = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    assert_span(out, stop, symbol + " 1d")
    save(rel, out)
    return out

def pull_um() -> dict[int, float]:
    return pull_vision("um", "BTCUSDT", UM_INDEX, UM_REL, False)

def main() -> None:
    if os.environ.get("FP115_OOS"):
        raise SystemExit("this pull does not request a later year")
    bars = pull_spot()
    um = pull_um()
    print("fp115 " + f"BTCUSDT 1d {len(bars)} first {min(bars)} last {max(bars)}" + "; " + f"um {len(um)} first {min(um)} last {max(um)}")


if __name__ == "__main__":
    main()
