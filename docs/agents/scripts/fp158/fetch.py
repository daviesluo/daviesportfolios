"""Pull the inputs this rule stores. No later year is requested as a signal.

    python3 docs/agents/scripts/fp158/fetch.py
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

DATA = Path(os.environ.get("FP158_DATA", "/tmp/fp158/data"))
VISION = "https://data.binance.vision"
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp158-research"}
EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)


def get(url: str, missing_ok: bool = False) -> bytes | None:
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as res:
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


def save(rel: str, rows: dict) -> None:
    path = DATA / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = []
    for t in sorted(rows):
        value = rows[t]
        payload.append([t, *value] if isinstance(value, tuple) else [t, value])
    path.write_text(json.dumps(payload, separators=(",", ":")))


def assert_span(rows: dict, end_ms: int, label: str, full: bool) -> None:
    if not rows:
        raise SystemExit(label + " came back empty")
    if min(rows) != LOOKBACK_MS:
        raise SystemExit(label + " does not start on 2022-10-01")
    if max(rows) != end_ms:
        raise SystemExit(label + " stops on the wrong day")
    if not full:
        return
    t = LOOKBACK_MS
    while t <= end_ms:
        if t not in rows:
            raise SystemExit(label + " is missing a day")
        t += c.fp5.DAY_MS


def months(last: str) -> list[str]:
    out = []
    y, m = 2022, 10
    stop_y, stop_m = int(last[:4]), int(last[5:7])
    while (y, m) <= (stop_y, stop_m):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def pull_opens(symbol: str, path: str, end_ms: int, rel: str, width: int) -> dict[int, tuple]:
    cursor = LOOKBACK_MS
    rows: dict[int, tuple] = {}
    while cursor <= end_ms:
        url = (
            f"{MARKET}{path}?symbol={symbol}&interval=1d"
            f"&startTime={cursor}&endTime={end_ms}&limit=1000"
        )
        batch = json.loads(get(url))
        if not batch:
            break
        for k in batch:
            open_ms = int(k[0])
            if open_ms < LOOKBACK_MS or open_ms > end_ms:
                continue
            if width == 1:
                rows[open_ms] = (float(k[1]),)
            elif width == 2:
                rows[open_ms] = (float(k[1]), float(k[4]))
            elif width == 3:
                rows[open_ms] = (float(k[1]), float(k[3]), float(k[4]))
            else:
                raise SystemExit("the bar width is not one this rule stores")
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    assert_span(rows, end_ms, symbol + " 1d", True)
    save(rel, rows)
    return rows


def pull_um_open(end_ms: int) -> dict[int, tuple]:
    rows: dict[int, tuple] = {}
    last = datetime.datetime.fromtimestamp(end_ms / 1000, datetime.timezone.utc).strftime("%Y-%m")
    for ym in months(last):
        url = (
            f"{VISION}/data/futures/um/monthly/klines/BTCUSDT/1d/"
            f"BTCUSDT-1d-{ym}.zip"
        )
        raw = get(url, missing_ok=True)
        if raw is None:
            continue
        zf = zipfile.ZipFile(io.BytesIO(raw))
        for row in csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())):
            if not row or row[0] == "open_time" or len(row) < 2:
                continue
            open_ms = int(row[0])
            if open_ms < LOOKBACK_MS or open_ms > end_ms:
                continue
            if open_ms in rows:
                raise SystemExit(f"two perpetual bars share {open_ms}")
            rows[open_ms] = (float(row[1]),)
    assert_span(rows, end_ms, "BTCUSDT perpetual 1d", True)
    save("um1d/BTCUSDT.json", rows)
    return rows


def pull_premium_close() -> dict[int, tuple]:
    out: dict[int, tuple] = {}
    stop = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    for ym in months("2023-12"):
        url = (
            f"{VISION}/data/futures/um/monthly/premiumIndexKlines/BTCUSDT/1d/"
            f"BTCUSDT-1d-{ym}.zip"
        )
        zf = zipfile.ZipFile(io.BytesIO(get(url)))
        for row in csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())):
            if not row or row[0] == "open_time" or len(row) < 5:
                continue
            open_ms = int(row[0])
            if open_ms < LOOKBACK_MS or open_ms > stop:
                continue
            if open_ms in out:
                raise SystemExit(f"two premium bars share {open_ms}")
            out[open_ms] = (float(row[4]),)
    if not out or min(out) != LOOKBACK_MS or max(out) != stop:
        raise SystemExit("premium does not span the window")
    if len(out) < 440:
        raise SystemExit("premium days are too few")
    if any(t >= c.fp5.SCREEN_END_MS for t in out):
        raise SystemExit("a premium bar is in 2024")
    save("premium/close.json", out)
    return out


def pull_funding(last_day_ms: int) -> dict[int, tuple]:
    out: dict[int, tuple] = {}
    last = datetime.datetime.fromtimestamp(last_day_ms / 1000, datetime.timezone.utc).strftime("%Y-%m")
    for ym in months(last):
        if ym > "2023-12":
            raise SystemExit("a 2024 funding file was requested")
        url = (
            f"{VISION}/data/futures/um/monthly/fundingRate/BTCUSDT/"
            f"BTCUSDT-fundingRate-{ym}.zip"
        )
        zf = zipfile.ZipFile(io.BytesIO(get(url)))
        for row in csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())):
            if not row or row[0] in ("calc_time", "fundingTime") or len(row) < 3:
                continue
            ts = int(row[0])
            bucket = c.fp5.bucket_8h(ts)
            if bucket is None or bucket < LOOKBACK_MS or bucket > last_day_ms + c.fp5.DAY_MS:
                continue
            if bucket in out:
                raise SystemExit(f"two funding prints share {bucket}")
            out[bucket] = (float(row[2]),)
    if not out:
        raise SystemExit("funding came back empty")
    if any(t >= c.fp5.SCREEN_END_MS + c.fp5.DAY_MS for t in out):
        raise SystemExit("a funding print is past 2024-01-01")
    save("funding/BTCUSDT.json", out)
    return out


def pull_metric_ends(last_ymd: str, fields: str) -> dict[int, tuple]:
    """`fields` is `taker` or `oi`. One row per UTC day. The path inside the day is not stored."""
    start = datetime.datetime(2022, 10, 1, tzinfo=datetime.timezone.utc)
    stop = datetime.datetime.strptime(last_ymd, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc)
    if stop > datetime.datetime(2024, 1, 4, tzinfo=datetime.timezone.utc):
        raise SystemExit("a metrics day past the exit window was requested")
    day = start
    rows: dict[int, tuple] = {}
    while day <= stop:
        ymd = day.strftime("%Y-%m-%d")
        url = (
            f"{VISION}/data/futures/um/daily/metrics/BTCUSDT/"
            f"BTCUSDT-metrics-{ymd}.zip"
        )
        raw = get(url)
        zf = zipfile.ZipFile(io.BytesIO(raw))
        parsed = list(csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())))
        header = parsed[0]
        idx = {name: i for i, name in enumerate(header)}
        body = [r for r in parsed[1:] if r and r[0] != "create_time"]
        if not body:
            raise SystemExit(ymd + " has no metric prints")
        body.sort(key=lambda r: r[0])
        if not body[0][0].startswith(ymd) or not body[-1][0].startswith(ymd):
            raise SystemExit(ymd + " holds another day's print")
        open_ms = int(day.timestamp() * 1000)
        if fields == "taker":
            rows[open_ms] = (float(body[-1][idx["sum_taker_long_short_vol_ratio"]]),)
        elif fields == "oi":
            rows[open_ms] = (
                float(body[0][idx["sum_open_interest_value"]]),
                float(body[-1][idx["sum_open_interest_value"]]),
            )
        else:
            raise SystemExit("the metric field is not one this rule stores")
        day += datetime.timedelta(days=1)
    end_ms = int(stop.timestamp() * 1000)
    assert_span(rows, end_ms, "metrics " + fields, True)
    rel = "taker/last.json" if fields == "taker" else "oi/ends.json"
    save(rel, rows)
    return rows



def main() -> None:
    if os.environ.get("FP158_OOS"):
        raise SystemExit("this pull does not request a later year")
    end = c.fp5.SCREEN_END_MS
    spot = pull_opens("BTCUSDT", "/api/v3/klines", end, "spot1d/BTCUSDT.json", 3)
    print("fp158 " + f"spot {len(spot)}")


if __name__ == "__main__":
    main()
