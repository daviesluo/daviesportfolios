"""Pull spot and USDT-perpetual quote volume for the fp140 screen. Trade counts are not stored. Taker-buy fields are not stored. No hourly price bar is requested.

    python3 docs/agents/scripts/fp140/fetch.py
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

DATA = Path(os.environ.get("FP140_DATA", "/tmp/fp140/data"))
VISION = "https://data.binance.vision"
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp140-research"}
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


def pull_spot_quote() -> tuple[dict[int, tuple], dict[int, float]]:
    end_ms = c.fp5.SCREEN_END_MS
    cursor = LOOKBACK_MS
    opens: dict[int, tuple] = {}
    quote: dict[int, float] = {}
    while cursor <= end_ms:
        url = (
            f"{MARKET}/api/v3/klines?symbol=BTCUSDT&interval=1d"
            f"&startTime={cursor}&endTime={end_ms}&limit=1000"
        )
        batch = json.loads(get(url))
        if not batch:
            break
        for k in batch:
            if len(k) < 8:
                raise SystemExit("a daily kline is missing the quote")
            open_ms = int(k[0])
            if open_ms < LOOKBACK_MS:
                continue
            if open_ms > end_ms:
                raise SystemExit(f"a daily bar opened past the screen: {open_ms}")
            opens[open_ms] = (float(k[1]),)
            if open_ms < end_ms:
                quote[open_ms] = float(k[7])
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    assert_span(opens, end_ms, "BTCUSDT 1d")
    assert_span(quote, end_ms - c.fp5.DAY_MS, "spot quote")
    save("spot1d/BTCUSDT.json", opens)
    return opens, quote


def pull_um_quote() -> dict[int, float]:
    ym_list = months()
    if ym_list[0] != "2022-10" or ym_list[-1] != "2023-12":
        raise SystemExit("the kline window moved")
    out: dict[int, float] = {}
    for ym in ym_list:
        if ym >= "2024-01":
            raise SystemExit("a 2024 perpetual file was requested")
        url = (
            f"{VISION}/data/futures/um/monthly/klines/BTCUSDT/1d/"
            f"BTCUSDT-1d-{ym}.zip"
        )
        raw = get(url)
        zf = zipfile.ZipFile(io.BytesIO(raw))
        names = zf.namelist()
        if len(names) != 1:
            raise SystemExit(ym + " zip has the wrong members")
        reader = csv.reader(io.StringIO(zf.read(names[0]).decode()))
        for row in reader:
            if not row or row[0] == "open_time":
                continue
            if len(row) <= 7:
                raise SystemExit("a perpetual kline is short")
            open_ms = int(row[0])
            if open_ms > 10**14:
                raise SystemExit("open_time is not milliseconds")
            if open_ms < LOOKBACK_MS:
                continue
            if open_ms >= c.fp5.SCREEN_END_MS:
                raise SystemExit("a perpetual bar is in 2024")
            if open_ms in out:
                raise SystemExit(f"two perpetual bars share {open_ms}")
            out[open_ms] = float(row[7])
    stop = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    assert_span(out, stop, "UM quote")
    return out


def pull_signal(spot: dict[int, float], um: dict[int, float]) -> dict[int, tuple]:
    out: dict[int, tuple] = {}
    for day, spot_quote in spot.items():
        um_quote = um.get(day)
        if um_quote is None or spot_quote <= 0 or um_quote <= 0:
            continue
        if day >= c.fp5.SCREEN_END_MS:
            continue
        out[day] = (spot_quote, um_quote)
    assert_span(out, c.fp5.SCREEN_END_MS - c.fp5.DAY_MS, "signal")
    if any(len(row) != 2 for row in out.values()):
        raise SystemExit("a mix row stored an extra field")
    save("mix/both.json", out)
    return out


def main() -> None:
    if os.environ.get("FP140_OOS"):
        raise SystemExit("this pull does not request a later year")
    _opens, spot = pull_spot_quote()
    signal = pull_signal(spot, pull_um_quote())
    print(
        "fp140 "
        + f"signal {len(signal)} first {min(signal)} last {max(signal)}"
        + "; "
        + f"BTCUSDT 1d {len(_opens)} first {min(_opens)} last {max(_opens)}"
    )


if __name__ == "__main__":
    main()
