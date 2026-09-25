"""Pull the public series the fp114 screen is allowed to see.

The signal stores the last top-trader position ratio and the last top-trader account ratio. Retail is not stored. No hourly price bar is requested. No funding print is requested.
No alt quote is requested. No bookDepth file is requested. Count long/short
and taker columns are not stored.

    python3 docs/agents/scripts/fp114/fetch.py
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

DATA = Path(os.environ.get("FP114_DATA", "/tmp/fp114/data"))
VISION = "https://data.binance.vision"
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp114-research"}
SPOT_FIELDS = (1,)
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

COLUMNS = (5, 4)
METRICS_REL = "metrics/pos_gap.json"
METRICS_MODE = "last"


def pull_metrics() -> dict[int, tuple]:
    days = metric_days()
    if days[0] != "2022-10-01" or days[-1] != "2023-12-31":
        raise SystemExit("the metrics window moved")
    if any(day >= "2024-01-01" for day in days):
        raise SystemExit("a 2024 metrics file was requested")
    out: dict[int, tuple] = {}
    for ymd in days:
        url = (
            f"{VISION}/data/futures/um/daily/metrics/BTCUSDT/"
            f"BTCUSDT-metrics-{ymd}.zip"
        )
        raw = get(url, missing_ok=True)
        if raw is None:
            continue
        zf = zipfile.ZipFile(io.BytesIO(raw))
        names = zf.namelist()
        if len(names) != 1:
            raise SystemExit(ymd + " zip has the wrong members")
        text = zf.read(names[0]).decode()
        reader = csv.reader(io.StringIO(text))
        header = next(reader)
        if header != METRICS_HEADER:
            raise SystemExit("the metrics header changed")
        file_ms = stamp_ms(ymd, "%Y-%m-%d")
        parsed = []
        for row in reader:
            if not row or all(cell.strip() == "" for cell in row):
                continue
            if len(row) != len(METRICS_HEADER):
                raise SystemExit(ymd + " has a short metrics row")
            if row[1] != "BTCUSDT":
                raise SystemExit(ymd + " names another symbol")
            ms = stamp_ms(row[0], "%Y-%m-%d %H:%M:%S")
            if ms // c.fp5.DAY_MS * c.fp5.DAY_MS != file_ms:
                raise SystemExit(ymd + " contains another date")
            if ms >= c.fp5.SCREEN_END_MS:
                raise SystemExit("a metrics print is in 2024")
            parsed.append((ms, row))
        if not parsed:
            continue
        parsed.sort()
        if len({ms for ms, _row in parsed}) != len(parsed):
            raise SystemExit(ymd + " repeats a timestamp")
        if METRICS_MODE == "last":
            _ms, row = parsed[-1]
            values = []
            for col in COLUMNS:
                value = num(row[col])
                if value is None:
                    values = []
                    break
                values.append(value)
            if not values:
                continue
            out[file_ms] = tuple(values)
        elif METRICS_MODE == "series":
            if len(COLUMNS) != 1:
                raise SystemExit("a series stores one column")
            values = []
            blank = False
            for _ms, row in parsed:
                value = num(row[COLUMNS[0]])
                if value is None:
                    blank = True
                    break
                values.append(value)
            if blank or len(values) < 2:
                continue
            out[file_ms] = tuple(values)
        else:
            raise SystemExit("unknown metrics mode")
    if any(t >= c.fp5.SCREEN_END_MS for t in out):
        raise SystemExit("a metrics day is in 2024")
    if not out:
        raise SystemExit("metrics came back empty")
    save(METRICS_REL, out)
    return out

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
                raise SystemExit("a daily kline is missing the open")
            open_ms = int(k[0])
            if open_ms < LOOKBACK_MS:
                continue
            if open_ms > end_ms:
                raise SystemExit(f"a daily bar opened past the screen: {open_ms}")
            rows[open_ms] = (float(k[1]),)
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    assert_span(rows, end_ms, "BTCUSDT 1d")
    if any(len(bar) != 1 for bar in rows.values()):
        raise SystemExit("a spot bar stored a signal field")
    save("spot1d/BTCUSDT.json", rows)
    return rows

def main() -> None:
    if os.environ.get("FP114_OOS"):
        raise SystemExit("this pull does not request a later year")
    metrics = pull_metrics()
    bars = pull_spot()
    print("fp114 " + f"metrics {len(metrics)} first {min(metrics)} last {max(metrics)}" + "; " + f"BTCUSDT 1d {len(bars)} first {min(bars)} last {max(bars)}")


if __name__ == "__main__":
    main()
