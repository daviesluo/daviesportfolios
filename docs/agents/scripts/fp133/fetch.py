"""Pull the public series this screen is allowed to see.

No rolling average is requested. No option file is requested. No hourly price
bar is requested. No funding print is requested. No mempool chart is requested.

    python3 docs/agents/scripts/fp133/fetch.py
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

DATA = Path(os.environ.get("FP133_DATA", "/tmp/fp133/data"))
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
LOOKBACK_S = 1_664_582_400
UA = {"User-Agent": "daviesportfolios-fp133-research"}
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

CHART = "https://api.blockchain.info/charts/output-volume"
UNIT = "BTC"


def pull_signal() -> dict[int, tuple]:
    url = CHART + "?start=2022-10-01&timespan=457days&format=json&sampled=false"
    payload = json.loads(get(url))
    if payload.get("unit") != UNIT:
        raise SystemExit("the chart unit moved")
    values = payload.get("values")
    if not isinstance(values, list) or not values:
        raise SystemExit("the chart came back empty")
    out: dict[int, tuple] = {}
    for point in values:
        stamp_s = int(point["x"])
        if stamp_s < LOOKBACK_S:
            continue
        if stamp_s >= c.fp5.SCREEN_END_MS // 1000:
            continue
        day = stamp_s * 1000 // c.fp5.DAY_MS * c.fp5.DAY_MS
        if day in out:
            raise SystemExit("two prints landed on one day")
        out[day] = (as_number(point["y"], "a chart point"),)
    assert_span(out, c.fp5.SCREEN_END_MS - c.fp5.DAY_MS, "signal")
    save("chain/output_btc.json", out)
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
    if os.environ.get("FP133_OOS"):
        raise SystemExit("this pull does not request a later year")
    signal = pull_signal()
    bars = pull_spot()
    print(
        "fp133 "
        + f"signal {len(signal)} first {min(signal)} last {max(signal)}"
        + "; "
        + f"BTCUSDT 1d {len(bars)} first {min(bars)} last {max(bars)}"
    )


if __name__ == "__main__":
    main()
