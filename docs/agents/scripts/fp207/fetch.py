"""Pull the inputs this rule stores. No later year is requested as a signal.

    python3 docs/agents/scripts/fp207/fetch.py
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

DATA = Path(os.environ.get("FP207_DATA", "/tmp/fp207/data"))
VISION = "https://data.binance.vision"
UA = {"User-Agent": "daviesportfolios-fp207-research"}


def get(url: str) -> bytes:
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as res:
                return res.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 404:
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


def kline_url(kind: str, symbol: str, ym: str, daily: bool = False) -> str:
    folder = "daily" if daily else "monthly"
    name = f"{symbol}-1d-2024-01-01.zip" if daily else f"{symbol}-1d-{ym}.zip"
    if kind == "spot":
        return f"{VISION}/data/spot/{folder}/klines/{symbol}/1d/{name}"
    return f"{VISION}/data/futures/{kind}/{folder}/klines/{symbol}/1d/{name}"


def pull_klines(kind: str, symbol: str, rel: str, indexes: tuple[int, ...], last_ms: int, first: tuple[int, int]) -> dict[int, tuple]:
    rows: dict[int, tuple] = {}
    for ym in months(first, (2023, 12)):
        for row in read_zip_rows(kline_url(kind, symbol, ym)):
            if not row or row[0] == "open_time":
                continue
            ts = int(row[0])
            if not keep_through(ts, last_ms):
                continue
            if len(row) <= max(indexes):
                raise SystemExit(symbol + " is missing a column")
            if 9 in indexes:
                volume = float(row[5])
                taker = float(row[9])
                if volume < 0.0 or taker < 0.0 or taker > volume:
                    raise SystemExit(symbol + " taker volume is not inside the book")
            if 10 in indexes:
                quote = float(row[7])
                taken = float(row[10])
                if quote < 0.0 or taken < 0.0 or taken > quote:
                    raise SystemExit(symbol + " taker quote is not inside the book")
            if 5 in indexes or 7 in indexes:
                base = float(row[5])
                quote = float(row[7])
                if base < 0.0 or quote < 0.0:
                    raise SystemExit(symbol + " has a negative size")
            rows[ts] = tuple(float(row[i]) for i in indexes)
    if not rows or max(rows) != last_ms:
        raise SystemExit(symbol + " stops on the wrong day")
    save(rel, rows)
    return rows


def pull_price(kind: str, indexes: tuple[int, ...], rel: str, last_ms: int) -> dict[int, tuple]:
    rows: dict[int, tuple] = {}
    folder = "indexPriceKlines" if kind == "index" else "markPriceKlines"
    for ym in months((2022, 12), (2023, 12)):
        url = (
            f"{VISION}/data/futures/um/monthly/{folder}/BTCUSDT/1d/"
            f"BTCUSDT-1d-{ym}.zip"
        )
        for row in read_zip_rows(url):
            if not row or row[0] == "open_time":
                continue
            ts = int(row[0])
            if not keep_through(ts, last_ms):
                continue
            if len(row) <= max(indexes):
                raise SystemExit(kind + " is missing a column")
            rows[ts] = tuple(float(row[i]) for i in indexes)
    if not rows or max(rows) != last_ms:
        raise SystemExit(kind + " stops on the wrong day")
    save(rel, rows)
    return rows


def add_exit(rows: dict[int, tuple], kind: str, symbol: str, indexes: tuple[int, ...], rel: str) -> dict[int, tuple]:
    """The 2024-01-01 bar is an exit. It is not a signal and not an entry."""
    kept = None
    for row in read_zip_rows(kline_url(kind, symbol, "", daily=True)):
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
    rows[c.fp5.SCREEN_END_MS] = kept
    if max(rows) != c.fp5.SCREEN_END_MS:
        raise SystemExit("the exits stop on the wrong day")
    save(rel, rows)
    return rows



def main() -> None:
    if os.environ.get("FP207_OOS"):
        raise SystemExit("this pull does not request a later year")
    last = c.SIGNAL_LAST_MS
    session = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    um = pull_klines("um", "BTCUSDT", "umcls/BTCUSDT.json", (4,), last, (2022, 12))
    index = pull_price("index", (4,), "index1d/BTCUSDT.json", last)
    spot = pull_klines("spot", "BTCUSDT", "spot1d/BTCUSDT.json", (4,), session, (2023, 1))
    spot = add_exit(spot, "spot", "BTCUSDT", (4,), "spot1d/BTCUSDT.json")
    print("fp207 " + f"um {len(um)} index {len(index)} spot {len(spot)} last {max(spot)}")


if __name__ == "__main__":
    main()
