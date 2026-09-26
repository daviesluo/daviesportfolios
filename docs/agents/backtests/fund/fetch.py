"""FUND: pull the inputs the scorer reads, keylessly, check them, and store them gzipped.

    python3 docs/agents/backtests/fund/fetch.py

The pre-registration is docs/agents/reviews/2026-09-26-fund-crowding-prereg.md. This file only pulls
and checks; it computes no return. It writes four files to inputs/:

  funding_btcusdt.json.gz    [fundingTime ms, fundingRate as published] for every BTCUSDT settlement
                             from 2019-09-10 08:00 to 2026-09-24 16:00 UTC, from the history endpoint
                             on www.binance.com (the frozen source, and the only one before 2020),
                             checked against data.binance.vision's monthly archive 2020-01 → 2026-08
  sofr.json.gz               [effectiveDate, percent as published], 2019-06-03 → 2026-09-24,
                             from the New York Fed
  spot_btcusdt_open.json.gz  [UTC day ms, open as published], 2019-09-11 → 2026-09-25, from
                             data.binance.vision (monthly 1d klines to 2026-08, then the daily files),
                             each zip checked against its published sha256
  coinbase_btcusd_open.json.gz  [UTC day ms, open], the same days, for the descriptive line only

Public reads only. No key is read. fapi.binance.com answers 451 from some networks, so the
funding history is read from www.binance.com, as the frozen fetchers did (fp313/fp317).
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import sys
import time
import urllib.error
import urllib.request
import zipfile
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "inputs"
UA = {"User-Agent": "Mozilla/5.0 daviesportfolios-fund-research"}
HISTORY = "https://www.binance.com/fapi/v1/fundingRate"
VISION = "https://data.binance.vision"
NYFED = "https://markets.newyorkfed.org/api/rates/secured/sofr/search.json"
COINBASE = "https://api.exchange.coinbase.com/products/BTC-USD/candles"

EIGHT_H = 8 * 3_600_000
DAY = 86_400_000

FUND_FIRST = 1_568_102_400_000  # 2019-09-10 08:00 UTC, the first BTCUSDT settlement
FUND_LAST_BUCKET = 1_790_265_600_000  # 2026-09-24 16:00 UTC
SOFR_FIRST, SOFR_LAST = "2019-06-03", "2026-09-24"
OPEN_FIRST, OPEN_LAST = date(2019, 9, 11), date(2026, 9, 25)


def ms(d: date) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() * 1000)


def get(url: str) -> bytes:
    if url.startswith("https://fapi.binance.com") or url.startswith("https://dapi.binance.com"):
        raise SystemExit("that host is not the one the frozen fetchers read")
    last = None
    for k in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as res:
                return res.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code not in (418, 429, 500, 502, 503, 504) or k == 5:
                raise
        except Exception as exc:  # noqa: BLE001 - retried, then raised
            last = exc
            if k == 5:
                raise
        time.sleep(1.0 * (k + 1))
    raise RuntimeError(f"get failed: {last}")


def write_gz(name: str, rows: list) -> None:
    """Deterministic gzip: no file name and no time in the header."""
    raw = json.dumps(rows, separators=(",", ":")).encode()
    buf = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buf, mtime=0, compresslevel=9) as gz:
        gz.write(raw)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_bytes(buf.getvalue())
    print(f"{name}: {len(rows)} rows, {len(buf.getvalue())} bytes, sha256 "
          f"{hashlib.sha256(buf.getvalue()).hexdigest()}")


def zip_rows(raw: bytes) -> list[list[str]]:
    zf = zipfile.ZipFile(io.BytesIO(raw))
    names = zf.namelist()
    if len(names) != 1:
        raise SystemExit("a vision zip holds more than one file")
    return list(csv.reader(io.StringIO(zf.read(names[0]).decode())))


def vision_zip(path: str) -> list[list[str]]:
    """A vision zip, checked against the sha256 the archive publishes beside it."""
    raw = get(f"{VISION}/{path}")
    published = get(f"{VISION}/{path}.CHECKSUM").decode().split()[0].strip().lower()
    if hashlib.sha256(raw).hexdigest() != published:
        raise SystemExit(f"{path} does not match its published sha256")
    return zip_rows(raw)


def bucket(ts: int) -> int:
    """The 8-hour boundary a settlement stamp belongs to. A stamp before its boundary, or more
    than two minutes after it, stops the pull."""
    q, r = divmod(ts, EIGHT_H)
    if r > 120_000:
        raise SystemExit(f"settlement stamp {ts} is not within two minutes after an 8-hour boundary")
    return q * EIGHT_H


def pull_funding() -> None:
    rows: dict[int, str] = {}
    since = FUND_FIRST - 1
    end = FUND_LAST_BUCKET + EIGHT_H  # 2026-09-25 00:00: nothing at or after it is stored
    while True:
        batch = json.loads(get(f"{HISTORY}?symbol=BTCUSDT&startTime={since}&endTime={end - 1}&limit=1000"))
        if not batch:
            break
        for row in batch:
            if row.get("symbol") != "BTCUSDT":
                raise SystemExit("the history returned another symbol")
            ts = int(row["fundingTime"])
            if ts >= end:
                continue
            rate = row["fundingRate"]
            if ts in rows and rows[ts] != rate:
                raise SystemExit("two funding rates at one stamp")
            rows[ts] = rate
        last = int(batch[-1]["fundingTime"])
        if len(batch) < 1000 or last + 1 >= end:
            break
        since = last + 1
        time.sleep(0.2)
    stamps = sorted(rows)
    buckets = [bucket(t) for t in stamps]
    if buckets[0] != FUND_FIRST or buckets[-1] != FUND_LAST_BUCKET:
        raise SystemExit("the funding history does not start and end where the pre-registration says")
    if any(b - a != EIGHT_H for a, b in zip(buckets, buckets[1:])):
        raise SystemExit("a funding settlement is missing or doubled")

    # The monthly archive, 2020-01 → 2026-08: every stamp and every rate must match.
    archive: dict[int, str] = {}
    y, m = 2020, 1
    while (y, m) <= (2026, 8):
        for row in vision_zip(f"data/futures/um/monthly/fundingRate/BTCUSDT/BTCUSDT-fundingRate-{y:04d}-{m:02d}.zip"):
            if not row or not row[0].isdigit():
                continue
            archive[int(row[0])] = row[2]
        m += 1
        if m == 13:
            y, m = y + 1, 1
        time.sleep(0.05)
    lo, hi = min(archive), max(archive)
    span = {t: r for t, r in rows.items() if lo <= t <= hi}
    if set(span) != set(archive):
        raise SystemExit("the history and the archive hold different stamps")
    bad = [t for t in archive if Decimal(archive[t]) != Decimal(span[t])]
    if bad:
        raise SystemExit(f"{len(bad)} rates differ between the history and the archive")
    print(f"funding: history and archive agree on all {len(archive)} settlements from "
          f"{datetime.fromtimestamp(lo / 1000, timezone.utc):%Y-%m-%d %H:%M} to "
          f"{datetime.fromtimestamp(hi / 1000, timezone.utc):%Y-%m-%d %H:%M} UTC")
    write_gz("funding_btcusdt.json.gz", [[t, rows[t]] for t in stamps])


def pull_sofr() -> None:
    out: dict[str, str] = {}
    for a, b in (("2019-06-01", "2020-12-31"), ("2021-01-01", "2022-12-31"),
                 ("2023-01-01", "2024-12-31"), ("2025-01-01", SOFR_LAST)):
        payload = json.loads(get(f"{NYFED}?startDate={a}&endDate={b}&type=rate").decode(), parse_float=Decimal)
        for row in payload["refRates"]:
            if row.get("type") != "SOFR":
                raise SystemExit("the SOFR file holds another rate")
            d, pct = row["effectiveDate"], format(row["percentRate"], "f")
            if d in out and out[d] != pct:
                raise SystemExit("two SOFR prints for one date")
            out[d] = pct
        time.sleep(0.5)
    dates = sorted(d for d in out if SOFR_FIRST <= d <= SOFR_LAST)
    if dates[0] != SOFR_FIRST or dates[-1] != SOFR_LAST:
        raise SystemExit("SOFR does not start and end where the pre-registration says")
    write_gz("sofr.json.gz", [[d, out[d]] for d in dates])


def pull_spot() -> None:
    opens: dict[int, str] = {}

    def take(rows: list[list[str]]) -> None:
        for row in rows:
            if not row or not row[0].isdigit():
                continue
            t = int(row[0])
            if t > 10**14:  # the archive stamps in microseconds from 2025-01-01
                t //= 1000
            if t % DAY:
                raise SystemExit("a daily open is not at 00:00 UTC")
            if t in opens and opens[t] != row[1]:
                raise SystemExit("two opens for one day")
            opens[t] = row[1]

    y, m = OPEN_FIRST.year, OPEN_FIRST.month
    while (y, m) <= (2026, 8):
        take(vision_zip(f"data/spot/monthly/klines/BTCUSDT/1d/BTCUSDT-1d-{y:04d}-{m:02d}.zip"))
        m += 1
        if m == 13:
            y, m = y + 1, 1
        time.sleep(0.05)
    d = date(2026, 9, 1)
    while d <= OPEN_LAST:
        take(vision_zip(f"data/spot/daily/klines/BTCUSDT/1d/BTCUSDT-1d-{d.isoformat()}.zip"))
        d += timedelta(days=1)
        time.sleep(0.05)
    days = [t for t in sorted(opens) if ms(OPEN_FIRST) <= t <= ms(OPEN_LAST)]
    if days[0] != ms(OPEN_FIRST) or days[-1] != ms(OPEN_LAST):
        raise SystemExit("the spot opens do not start and end where the pre-registration says")
    if any(b - a != DAY for a, b in zip(days, days[1:])):
        raise SystemExit("a spot open is missing")
    if any(Decimal(opens[t]) <= 0 for t in days):
        raise SystemExit("an open is not a price")
    write_gz("spot_btcusdt_open.json.gz", [[t, opens[t]] for t in days])


def pull_coinbase() -> None:
    opens: dict[int, float] = {}
    a = OPEN_FIRST
    while a <= OPEN_LAST:
        b = min(a + timedelta(days=249), OPEN_LAST)
        url = (f"{COINBASE}?granularity=86400&start={a.isoformat()}T00:00:00Z"
               f"&end={b.isoformat()}T00:00:00Z")
        for row in json.loads(get(url)):
            t = int(row[0]) * 1000
            if t % DAY:
                raise SystemExit("a Coinbase candle is not at 00:00 UTC")
            if ms(OPEN_FIRST) <= t <= ms(OPEN_LAST):
                opens[t] = row[3]
        a = b + timedelta(days=1)
        time.sleep(0.4)
    days = sorted(opens)
    want = (ms(OPEN_LAST) - ms(OPEN_FIRST)) // DAY + 1
    print(f"coinbase: {len(days)} of {want} days have a candle")
    write_gz("coinbase_btcusd_open.json.gz", [[t, opens[t]] for t in days])


def main() -> None:
    what = sys.argv[1:] or ["funding", "sofr", "spot", "coinbase"]
    if "funding" in what:
        pull_funding()
    if "sofr" in what:
        pull_sofr()
    if "spot" in what:
        pull_spot()
    if "coinbase" in what:
        pull_coinbase()


if __name__ == "__main__":
    main()
