"""Pull the 00:00 and 16:00 USDT-margined funding rates for the fp144 screen. The 08:00 rate is not stored. The coin-margined book is not requested. No hourly price bar is requested.

    python3 docs/agents/scripts/fp144/fetch.py
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

DATA = Path(os.environ.get("FP144_DATA", "/tmp/fp144/data"))
VISION = "https://data.binance.vision"
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp144-research"}
EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)


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


def save(rel: str, rows: dict) -> None:
    path = DATA / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = []
    for t in sorted(rows):
        value = rows[t]
        payload.append([t, *value])
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


def pull_spot_open() -> dict[int, tuple]:
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
            if len(k) < 2:
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


def pull_um() -> dict[int, float]:
    points: dict[int, float] = {}
    ym_list = months()
    if ym_list[0] != "2022-10" or ym_list[-1] != "2023-12":
        raise SystemExit("the funding window moved")
    for ym in ym_list:
        if ym >= "2024-01":
            raise SystemExit("a 2024 funding file was requested")
        url = (
            f"{VISION}/data/futures/um/monthly/fundingRate/BTCUSDT/"
            f"BTCUSDT-fundingRate-{ym}.zip"
        )
        raw = get(url)
        zf = zipfile.ZipFile(io.BytesIO(raw))
        text = zf.read(zf.namelist()[0]).decode()
        for row in csv.DictReader(io.StringIO(text)):
            bucket = c.fp5.bucket_8h(int(row["calc_time"]))
            if bucket is None or bucket < LOOKBACK_MS:
                continue
            if bucket >= c.fp5.SCREEN_END_MS:
                continue
            rate = float(row["last_funding_rate"])
            if bucket in points and abs(points[bucket] - rate) > 1e-12:
                raise SystemExit(f"two funding rates share {bucket}")
            points[bucket] = rate
    if not points:
        raise SystemExit("funding came back empty")
    if max(points) >= c.fp5.SCREEN_END_MS:
        raise SystemExit("a funding print is in 2024")
    return points


def pull_signal(points: dict[int, float]) -> dict[int, tuple]:
    by_day: dict[int, list[tuple[int, float]]] = {}
    for bucket, rate in points.items():
        day = bucket // c.fp5.DAY_MS * c.fp5.DAY_MS
        by_day.setdefault(day, []).append((bucket, rate))
    out: dict[int, tuple] = {}
    eight = c.fp5.EIGHT_H_MS
    for day, items in by_day.items():
        items.sort()
        stamps = [stamp for stamp, _rate in items]
        want = [day, day + eight, day + 2 * eight]
        if stamps != want:
            continue
        out[day] = (items[0][1], items[2][1])
    assert_span(out, c.fp5.SCREEN_END_MS - c.fp5.DAY_MS, "signal")
    if any(len(row) != 2 for row in out.values()):
        raise SystemExit("a funding day did not keep the two ends")
    save("funding/ends.json", out)
    return out


def main() -> None:
    if os.environ.get("FP144_OOS"):
        raise SystemExit("this pull does not request a later year")
    signal = pull_signal(pull_um())
    bars = pull_spot_open()
    print(
        "fp144 "
        + f"signal {len(signal)} first {min(signal)} last {max(signal)}"
        + "; "
        + f"BTCUSDT 1d {len(bars)} first {min(bars)} last {max(bars)}"
    )


if __name__ == "__main__":
    main()
