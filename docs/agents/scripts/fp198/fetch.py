"""Pull the inputs this rule stores. No later year is requested as a signal.

    python3 docs/agents/scripts/fp198/fetch.py
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

DATA = Path(os.environ.get("FP198_DATA", "/tmp/fp198/data"))
VISION = "https://data.binance.vision"
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp198-research"}


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


def months(first: tuple[int, int], last: tuple[int, int]) -> list[str]:
    out = []
    y, m = first
    while (y, m) <= last:
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def read_zip_rows(url: str) -> list[list[str]]:
    raw = get(url)
    zf = zipfile.ZipFile(io.BytesIO(raw))
    return list(csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())))


def keep_through(ts: int, last_ms: int) -> bool:
    if ts > c.fp5.SCREEN_END_MS:
        raise SystemExit("a later year was requested")
    return ts <= last_ms


def pull_klines(kind: str, symbol: str, rel: str, indexes: tuple[int, ...], last_ms: int, first: tuple[int, int]) -> dict[int, tuple]:
    rows: dict[int, tuple] = {}
    for ym in months(first, (2023, 12)):
        url = (
            f"{VISION}/data/futures/{kind}/monthly/klines/{symbol}/1d/"
            f"{symbol}-1d-{ym}.zip"
        )
        for row in read_zip_rows(url):
            if not row or row[0] == "open_time":
                continue
            ts = int(row[0])
            if not keep_through(ts, last_ms):
                continue
            if len(row) <= max(indexes):
                raise SystemExit(symbol + " is missing a column")
            picked = tuple(float(row[i]) for i in indexes)
            if 9 in indexes:
                volume = float(row[5])
                taker = float(row[9])
                if volume < 0 or taker < 0 or taker > volume:
                    raise SystemExit(symbol + " taker volume is not inside the book")
            rows[ts] = picked
    if not rows or max(rows) != last_ms:
        raise SystemExit(symbol + " stops on the wrong day")
    save(rel, rows)
    return rows


def pull_coin_oi() -> dict[int, tuple]:
    """Coin open interest, first and last print. A missing file is not filled in."""
    from concurrent.futures import ThreadPoolExecutor

    start = datetime.datetime(2022, 12, 31, tzinfo=datetime.timezone.utc)
    stop = datetime.datetime.fromtimestamp(c.SIGNAL_LAST_MS / 1000, datetime.timezone.utc)
    days = []
    day = start
    while day <= stop:
        days.append(day.strftime("%Y-%m-%d"))
        day += datetime.timedelta(days=1)

    def one(ymd: str):
        if ymd >= "2024-01-01":
            raise SystemExit("a metrics day in 2024 was requested")
        url = (
            f"{VISION}/data/futures/um/daily/metrics/BTCUSDT/"
            f"BTCUSDT-metrics-{ymd}.zip"
        )
        raw = get(url, missing_ok=True)
        if raw is None:
            return ymd, None
        zf = zipfile.ZipFile(io.BytesIO(raw))
        parsed = list(csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())))
        header = parsed[0]
        col = {name: i for i, name in enumerate(header)}
        if "sum_open_interest" not in col:
            raise SystemExit(ymd + " has no coin open interest")
        body = [r for r in parsed[1:] if r and r[0] != "create_time"]
        if not body:
            raise SystemExit(ymd + " has no metric prints")
        body.sort(key=lambda r: r[0])
        if not body[0][0].startswith(ymd) or not body[-1][0].startswith(ymd):
            raise SystemExit(ymd + " holds another day's print")
        open_ms = int(
            datetime.datetime.strptime(ymd, "%Y-%m-%d").replace(
                tzinfo=datetime.timezone.utc
            ).timestamp()
            * 1000
        )
        coin_col = col["sum_open_interest"]
        return ymd, (open_ms, float(body[0][coin_col]), float(body[-1][coin_col]))

    rows: dict[int, tuple] = {}
    missed = []
    with ThreadPoolExecutor(8) as pool:
        for ymd, packed in pool.map(one, days):
            if packed is None:
                missed.append(ymd)
                continue
            open_ms, first, last = packed
            if not keep_through(open_ms, c.SIGNAL_LAST_MS):
                continue
            rows[open_ms] = (first, last)
    if len(rows) < 300 or max(rows) != c.SIGNAL_LAST_MS:
        raise SystemExit("coin open interest stops on the wrong day")
    save("oi/coin.json", rows)
    if missed:
        print("oi missing " + ",".join(sorted(missed)))
    return rows


def main() -> None:
    if os.environ.get("FP198_OOS"):
        raise SystemExit("this pull does not request a later year")
    last = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    um = pull_klines("um", "BTCUSDT", "um1d/BTCUSDT.json", (1, 4), last, (2023, 1))
    oi = pull_coin_oi()
    print("fp198 " + f"um {len(um)} last {max(um)} oi {len(oi)} last {max(oi)}")


if __name__ == "__main__":
    main()
