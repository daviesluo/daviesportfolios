"""Pull the public series this screen is allowed to see.

No rolling average is requested. No option file is requested. No hourly price
bar is requested. No funding print is requested. No mempool chart is requested.

    python3 docs/agents/scripts/fp132/fetch.py
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

DATA = Path(os.environ.get("FP132_DATA", "/tmp/fp132/data"))
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
LOOKBACK_S = 1_664_582_400
UA = {"User-Agent": "daviesportfolios-fp132-research"}
SPOT_FIELDS = (1,)


def get(url: str) -> bytes:
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as res:
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


def as_number(value, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise SystemExit(label + " is not a number")
    try:
        number = float(value)
    except ValueError as exc:
        raise SystemExit(label + " is not a number") from exc
    return number

CM = (
    "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
    "?assets=btc&metrics=BlkCnt&frequency=1d"
    "&start_time=2022-10-01&end_time=2024-01-01&page_size=10000"
)


def pull_signal() -> dict[int, tuple]:
    url = CM
    out: dict[int, tuple] = {}
    pages = 0
    while url:
        pages += 1
        if pages > 3:
            raise SystemExit("block count took more pages than the window holds")
        payload = json.loads(get(url))
        rows = payload.get("data")
        if not isinstance(rows, list):
            raise SystemExit("block count came back empty")
        for row in rows:
            stamp = str(row.get("time") or "")
            if stamp >= "2024-01-01":
                continue
            if len(stamp) < 10:
                raise SystemExit("a block-count row has no day")
            day_d = datetime.date.fromisoformat(stamp[:10])
            day = int(datetime.datetime(day_d.year, day_d.month, day_d.day, tzinfo=datetime.timezone.utc).timestamp()) * 1000
            if day in out:
                raise SystemExit("two block counts landed on one day")
            out[day] = (as_number(row.get("BlkCnt"), "a block count"),)
        url = payload.get("next_page_url") or ""
    assert_span(out, c.fp5.SCREEN_END_MS - c.fp5.DAY_MS, "signal")
    save("blocks/count.json", out)
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
    if os.environ.get("FP132_OOS"):
        raise SystemExit("this pull does not request a later year")
    signal = pull_signal()
    bars = pull_spot()
    print(
        "fp132 "
        + f"signal {len(signal)} first {min(signal)} last {max(signal)}"
        + "; "
        + f"BTCUSDT 1d {len(bars)} first {min(bars)} last {max(bars)}"
    )


if __name__ == "__main__":
    main()
