"""Pull the inputs this rule stores. No later year is requested as a signal.

    python3 docs/agents/scripts/fp212/fetch.py
"""

from __future__ import annotations

import csv
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

DATA = Path(os.environ.get("FP212_DATA", "/tmp/fp212/data"))
VISION = "https://data.binance.vision"
UA = {"User-Agent": "daviesportfolios-fp212-research"}


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


def read_zip_rows(raw: bytes) -> list[list[str]]:
    zf = zipfile.ZipFile(io.BytesIO(raw))
    return list(csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())))


def keep_through(ts: int, last_ms: int) -> bool:
    if ts > c.fp5.SCREEN_END_MS:
        raise SystemExit("a later year was requested")
    return ts <= last_ms


def kline_url(kind: str, symbol: str, ym: str, daily: bool = False) -> str:
    folder = "daily" if daily else "monthly"
    name = f"{symbol}-1d-2024-01-01.zip" if daily else f"{symbol}-1d-{ym}.zip"
    if kind == "spot":
        return f"{VISION}/data/spot/{folder}/klines/{symbol}/1d/{name}"
    return f"{VISION}/data/futures/{kind}/{folder}/klines/{symbol}/1d/{name}"


def pull_klines(kind: str, symbol: str, indexes: tuple[int, ...], last_ms: int, first: tuple[int, int]) -> dict[int, tuple]:
    rows: dict[int, tuple] = {}
    for ym in months(first, (2023, 12)):
        raw = get(kline_url(kind, symbol, ym))
        for row in read_zip_rows(raw):
            if not row or row[0] == "open_time":
                continue
            ts = int(row[0])
            if not keep_through(ts, last_ms):
                continue
            if len(row) <= max(indexes):
                raise SystemExit(symbol + " is missing a column")
            if 5 in indexes or 7 in indexes:
                base = float(row[5])
                quote = float(row[7])
                if base < 0.0 or quote < 0.0:
                    raise SystemExit(symbol + " has a negative size")
            rows[ts] = tuple(float(row[i]) for i in indexes)
    if not rows or max(rows) != last_ms:
        raise SystemExit(symbol + " stops on the wrong day")
    return rows


def project(rows: dict[int, tuple], indexes: tuple[int, ...], last_ms: int, rel: str, required: bool) -> dict[int, tuple]:
    kept = {}
    for ts, row in rows.items():
        if ts > last_ms:
            continue
        kept[ts] = tuple(row[i] for i in indexes)
    if not kept:
        raise SystemExit(rel + " came back empty")
    if required and max(kept) != last_ms:
        raise SystemExit(rel + " stops on the wrong day")
    save(rel, kept)
    return kept


def pull_price(indexes: tuple[int, ...], last_ms: int) -> dict[int, tuple]:
    rows: dict[int, tuple] = {}
    for ym in months((2022, 12), (2023, 12)):
        url = (
            f"{VISION}/data/futures/um/monthly/markPriceKlines/BTCUSDT/1d/"
            f"BTCUSDT-1d-{ym}.zip"
        )
        raw = get(url)
        for row in read_zip_rows(raw):
            if not row or row[0] == "open_time":
                continue
            ts = int(row[0])
            if not keep_through(ts, last_ms):
                continue
            if len(row) <= max(indexes):
                raise SystemExit("mark is missing a column")
            rows[ts] = tuple(float(row[i]) for i in indexes)
    if not rows or max(rows) != last_ms:
        raise SystemExit("mark stops on the wrong day")
    return rows


def add_exit(rows: dict[int, tuple], kind: str, symbol: str, indexes: tuple[int, ...], rel: str) -> dict[int, tuple]:
    """The 2024-01-01 bar is an exit. It is not a signal and not an entry."""
    raw = get(kline_url(kind, symbol, "", daily=True))
    kept = None
    for row in read_zip_rows(raw):
        if not row or row[0] == "open_time":
            continue
        ts = int(row[0])
        if ts != c.fp5.SCREEN_END_MS:
            raise SystemExit("the exit file holds another day")
        if len(row) <= max(indexes):
            raise SystemExit("the exit file is missing a column")
        kept = tuple(float(row[i]) for i in indexes)
    if kept is None:
        raise SystemExit("the 2024 bar was not in the exit file")
    rows = dict(rows)
    rows[c.fp5.SCREEN_END_MS] = kept
    if max(rows) != c.fp5.SCREEN_END_MS:
        raise SystemExit("the exits stop on the wrong day")
    save(rel, rows)
    return rows


def pull_funding(kind: str, symbol: str, rel: str) -> dict[int, float]:
    """Store the 16:00 rate only, keyed by that UTC day. Later hours are not stored."""
    rows: dict[int, float] = {}
    last_day = c.SIGNAL_LAST_MS
    for ym in months((2022, 12), (2023, 12)):
        url = (
            f"{VISION}/data/futures/{kind}/monthly/fundingRate/{symbol}/"
            f"{symbol}-fundingRate-{ym}.zip"
        )
        raw = get(url)
        for row in read_zip_rows(raw):
            if not row or row[0] in ("calc_time", "fundingTime") or len(row) < 3:
                continue
            bucket = c.fp5.bucket_8h(int(row[0]))
            if bucket is None or bucket >= c.fp5.SCREEN_END_MS:
                continue
            if bucket % c.fp5.DAY_MS != 2 * c.fp5.EIGHT_H_MS:
                continue
            day = bucket - 2 * c.fp5.EIGHT_H_MS
            if day > last_day:
                continue
            if day in rows:
                raise SystemExit(f"two funding prints share {day}")
            rows[day] = float(row[2])
    if not rows or max(rows) != last_day:
        raise SystemExit(symbol + " funding stops on the wrong day")
    if any(ts >= c.fp5.SCREEN_END_MS for ts in rows):
        raise SystemExit("a 2024 funding print was stored")
    save(rel, rows)
    return rows


def pull_quarter(symbol: str, last_ms: int) -> dict[int, tuple]:
    rows: dict[int, tuple] = {}
    for ym in months((2022, 12), (2023, 12)):
        raw = get(kline_url("cm", symbol, ym), missing_ok=True)
        if raw is None:
            continue
        for row in read_zip_rows(raw):
            if not row or row[0] == "open_time":
                continue
            ts = int(row[0])
            if not keep_through(ts, last_ms):
                continue
            if len(row) <= 4:
                raise SystemExit(symbol + " is missing a column")
            rows[ts] = (float(row[1]), float(row[4]))
    if not rows:
        raise SystemExit(symbol + " came back empty")
    if max(rows) > last_ms:
        raise SystemExit(symbol + " goes past the window")
    save(f"cm1d/{symbol}.json", rows)
    return rows

def main() -> None:
    if os.environ.get("FP212_OOS"):
        raise SystemExit("this pull does not request a later year")
    last = c.SIGNAL_LAST_MS
    session = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    perp = pull_klines("cm", "BTCUSD_PERP", (1, 4), session, (2022, 12))
    project(perp, (0, 1), last, "perpsig/BTCUSD_PERP.json", True)
    project(perp, (0, 1), session, "cm1d/BTCUSD_PERP.json", True)
    counts = []
    for _expiry, symbol in c.QUARTERS:
        book = pull_quarter(symbol, session)
        counts.append(f"{symbol} {len(book)}")
    print("fp212 " + f"perp {len(perp)} " + " ".join(counts))


if __name__ == "__main__":
    main()
