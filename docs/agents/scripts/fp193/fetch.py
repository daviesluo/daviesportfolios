"""Pull the inputs this rule stores. No later year is requested as a signal.

    python3 docs/agents/scripts/fp193/fetch.py
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

DATA = Path(os.environ.get("FP193_DATA", "/tmp/fp193/data"))
VISION = "https://data.binance.vision"
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp193-research"}


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


def assert_spot(rows: dict, end_ms: int) -> None:
    if not rows or min(rows) != LOOKBACK_MS or max(rows) != end_ms:
        raise SystemExit("BTCUSDT 1d does not span the window")
    t = LOOKBACK_MS
    while t <= end_ms:
        if t not in rows:
            raise SystemExit("BTCUSDT 1d is missing a day")
        t += c.fp5.DAY_MS


def pull_spot(indexes: tuple[int, ...]) -> dict[int, tuple]:
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
        for kline in batch:
            open_ms = int(kline[0])
            if open_ms < LOOKBACK_MS or open_ms > end_ms:
                continue
            rows[open_ms] = tuple(float(kline[i]) for i in indexes)
        nxt = int(batch[-1][0]) + c.fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    assert_spot(rows, end_ms)
    save("spot1d/BTCUSDT.json", rows)
    return rows


def pull_book() -> dict[int, tuple]:
    """Last snapshot only. A missing day is left missing and is not filled in."""
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
            raise SystemExit("a book day in 2024 was requested")
        url = (
            f"{VISION}/data/futures/um/daily/bookDepth/BTCUSDT/"
            f"BTCUSDT-bookDepth-{ymd}.zip"
        )
        raw = get(url, missing_ok=True)
        if raw is None:
            return ymd, None
        zf = zipfile.ZipFile(io.BytesIO(raw))
        parsed = list(csv.DictReader(io.StringIO(zf.read(zf.namelist()[0]).decode())))
        by = {}
        for row in parsed:
            if not row.get("timestamp", "").startswith(ymd):
                raise SystemExit(ymd + " holds another day's book")
            by.setdefault(row["timestamp"], []).append(row)
        if not by:
            raise SystemExit(ymd + " has no book snapshots")
        stamps = sorted(by)
        bid = ask = 0.0
        saw_bid = saw_ask = False
        for row in by[stamps[-1]]:
            pct = float(row["percentage"])
            notion = float(row["notional"])
            if pct < 0:
                bid += notion
                saw_bid = True
            elif pct > 0:
                ask += notion
                saw_ask = True
        if not saw_bid or not saw_ask:
            return ymd, None
        open_ms = int(
            datetime.datetime.strptime(ymd, "%Y-%m-%d").replace(
                tzinfo=datetime.timezone.utc
            ).timestamp()
            * 1000
        )
        return ymd, (open_ms, bid, ask)

    rows: dict[int, tuple] = {}
    missed = []
    with ThreadPoolExecutor(8) as pool:
        for ymd, packed in pool.map(one, days):
            if packed is None:
                missed.append(ymd)
                continue
            open_ms, bid, ask = packed
            if not keep_through(open_ms, c.SIGNAL_LAST_MS):
                continue
            rows[open_ms] = (bid, ask)
    if len(rows) < 300:
        raise SystemExit("the book came back short")
    if max(rows) != c.SIGNAL_LAST_MS:
        raise SystemExit("the book stops on the wrong day")
    save("book/BTCUSDT.json", rows)
    print("book missing " + ",".join(sorted(missed)))
    return rows


def main() -> None:
    if os.environ.get("FP193_OOS"):
        raise SystemExit("this pull does not request a later year")
    spot = pull_spot((1, 4))
    book = pull_book()
    print("fp193 " + f"spot {len(spot)} last {max(spot)} book {len(book)} last {max(book)}")


if __name__ == "__main__":
    main()
