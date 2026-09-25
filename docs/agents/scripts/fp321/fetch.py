"""Pull the inputs this rule stores. No later year is requested as an entry.

    python3 docs/agents/scripts/fp321/fetch.py
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
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

DATA = Path(os.environ.get("FP321_DATA", "/tmp/fp321/data"))
VISION = "https://data.binance.vision"
UA = {"User-Agent": "Mozilla/5.0 daviesportfolios-fp321-research"}
COMMUNITY = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
# PriceUSD and ReferenceRateUSD are market prices. They are not requested.
METRICS = "CapMrktCurUSD,CapMVRVCur,SplyCur,AssetEODCompletionTime"


def get(url: str) -> bytes:
    if url.startswith("https://fapi.binance.com") or url.startswith("https://dapi.binance.com"):
        raise SystemExit("that host is not the one this pull measured")
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as res:
                return res.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 404 or exc.code not in (418, 429, 500, 502, 503) or k + 1 == 6:
                raise
        except Exception as exc:
            last = exc
            if k + 1 == 6:
                raise
        time.sleep(1.0 * (k + 1))
    raise RuntimeError(f"get failed {last}")


def months() -> list[str]:
    out = []
    y, m = 2023, 1
    while (y, m) <= (2023, 12):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def read_zip_rows(raw: bytes) -> list[list[str]]:
    zf = zipfile.ZipFile(io.BytesIO(raw))
    return list(csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())))


def kline_url(ym: str) -> str:
    symbol = c.SYMBOL
    if c.RULE_BOOK == "cm":
        return (
            f"{VISION}/data/futures/cm/monthly/klines/{symbol}/1d/"
            f"{symbol}-1d-{ym}.zip"
        )
    if c.RULE_BOOK == "spot":
        return f"{VISION}/data/spot/monthly/klines/{symbol}/1d/{symbol}-1d-{ym}.zip"
    raise SystemExit("the book is not named")


def exit_url() -> str:
    symbol = c.SYMBOL
    if c.RULE_BOOK == "cm":
        kind = "futures/cm"
    elif c.RULE_BOOK == "spot":
        kind = "spot"
    else:
        raise SystemExit("the book is not named")
    return f"{VISION}/data/{kind}/daily/klines/{symbol}/1d/{symbol}-1d-2024-01-01.zip"


def take_bar(row: list[str], rows: dict[int, tuple[str, str]]) -> None:
    if not row or row[0] == "open_time":
        return
    ts = int(row[0])
    if ts > c.fp5.SCREEN_END_MS:
        raise SystemExit("a later year was requested")
    opened, closed = row[1], row[4]
    if Decimal(opened) <= 0 or Decimal(closed) <= 0:
        raise SystemExit("a bar is not a price")
    if ts in rows and rows[ts] != (opened, closed):
        raise SystemExit("two bars at one stamp")
    rows[ts] = (opened, closed)


def pull_opens() -> dict[int, tuple[str, str]]:
    rows: dict[int, tuple[str, str]] = {}
    seen = False
    for ym in months():
        url = kline_url(ym)
        try:
            raw = get(url)
        except urllib.error.HTTPError as exc:
            if exc.code == 404 and not seen:
                continue
            raise
        seen = True
        for row in read_zip_rows(raw):
            take_bar(row, rows)
    if not seen:
        raise SystemExit("no month was published")
    kept = None
    for row in read_zip_rows(get(exit_url())):
        if not row or row[0] == "open_time":
            continue
        ts = int(row[0])
        if ts != c.fp5.SCREEN_END_MS:
            raise SystemExit("the exit file holds another day")
        opened, closed = row[1], row[4]
        if Decimal(opened) <= 0 or Decimal(closed) <= 0:
            raise SystemExit("the 2024 open was not a price")
        kept = (opened, closed)
    if kept is None:
        raise SystemExit("the 2024 open was not in the exit file")
    rows[c.fp5.SCREEN_END_MS] = kept
    if len(rows) != c.BOOK_ROWS or min(rows) != c.BOOK_FIRST or max(rows) != c.fp5.SCREEN_END_MS:
        raise SystemExit(c.SYMBOL + " stops on the wrong day")
    for stamp in c.ABSENT:
        if stamp in rows:
            raise SystemExit("a missing month was filled in")
    if c.GAP:
        for iso in ("2023-08-28", "2023-08-29", "2023-08-30", "2023-08-31"):
            year, month, day = (int(part) for part in iso.split("-"))
            stamp = int(datetime(year, month, day, tzinfo=timezone.utc).timestamp() * 1000)
            if stamp in rows:
                raise SystemExit("the coin-margined gap was filled in")
    path = DATA / c.BOOK_DIR / f"{c.SYMBOL}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [[t, rows[t][0], rows[t][1]] for t in sorted(rows)]
    path.write_text(json.dumps(payload, separators=(",", ":")))
    return rows


def pull_realized() -> dict[int, str]:
    if c.FAIR_KIND != "realized":
        raise SystemExit("this pull is the realized price")
    url = (
        f"{COMMUNITY}?assets=eth&metrics={METRICS}"
        "&frequency=1d&start_time=2022-11-01&end_time=2024-01-05&page_size=10000"
    )
    rows: dict[int, str] = {}
    while url:
        payload = json.loads(get(url).decode())
        for row in payload["data"]:
            for key in ("CapMrktCurUSD", "CapMVRVCur", "SplyCur", "AssetEODCompletionTime"):
                if row.get(key) in (None, ""):
                    raise SystemExit("a realized-price input is missing")
                if key != "AssetEODCompletionTime" and Decimal(row[key]) == 0:
                    raise SystemExit("a realized price divides by zero")
            px = Decimal(row["CapMrktCurUSD"]) / Decimal(row["CapMVRVCur"]) / Decimal(row["SplyCur"])
            if px <= 0:
                raise SystemExit("a realized price is not a price")
            pub = int(row["AssetEODCompletionTime"]) * 1000
            if pub >= c.fp5.SCREEN_END_MS:
                continue
            text = format(px, "f")
            if pub in rows and rows[pub] != text:
                raise SystemExit("two realized prices at one publication")
            rows[pub] = text
        url = payload.get("next_page_url") or ""
    stamps = sorted(rows)
    if (
        len(stamps) != c.FAIR_N
        or stamps[0] != c.FAIR_FIRST
        or stamps[-1] != c.FAIR_LAST
        or rows[stamps[0]] != c.FAIR_FIRST_PX
        or rows[stamps[-1]] != c.FAIR_LAST_PX
    ):
        raise SystemExit("the realized price does not have the frozen shape")
    path = DATA / c.FAIR_DIR / c.FAIR_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([[t, rows[t]] for t in stamps], separators=(",", ":")))
    return rows


def main() -> None:
    if os.environ.get("FP321_OOS"):
        raise SystemExit("this pull does not request a later year")
    opens = pull_opens()
    fair = pull_realized()
    print(f"fp321 {len(opens)} {len(fair)}")


if __name__ == "__main__":
    main()
