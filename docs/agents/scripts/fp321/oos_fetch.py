"""Pull the out-of-sample inputs named in the EREAL pre-registration.

The coin-margined book runs from 2024-01-01 through the 2026-09-25 open.
That last bar is an exit open. It is not an entry. A bar on 2026-09-26 is
not requested. A missing day is not filled in. The realized price is stored
only when its publication is strictly earlier than 2026-09-24. Refuses to
run until the pre-registration's sha256 matches.

    python3 docs/agents/scripts/fp321/oos_fetch.py
"""

from __future__ import annotations

import csv
import hashlib
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

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP321_DATA", "/tmp/fp321/data"))
PREREG = ROOT / "docs/agents/reviews/2026-09-25-fp321-prereg-ereal.md"
SIDECAR = ROOT / "docs/agents/reviews/2026-09-25-fp321-prereg-ereal.sha256"
VISION = "https://data.binance.vision"
LIVE = "https://www.binance.com/dapi/v1/klines"
COMMUNITY = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
METRICS = "CapMrktCurUSD,CapMVRVCur,SplyCur,AssetEODCompletionTime"
UA = {"User-Agent": "Mozilla/5.0 daviesportfolios-fp321-research"}

OOS_START = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)
EXIT_OPEN = int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000)
ENTRY_END = int(datetime(2026, 9, 24, tzinfo=timezone.utc).timestamp() * 1000)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require_frozen() -> None:
    if sha256(PREREG) != SIDECAR.read_text().strip():
        raise SystemExit("the pre-registration does not match its frozen sha256")


def get(url: str, missing_ok: bool = False) -> bytes | None:
    if url.startswith("https://fapi.binance.com") or url.startswith("https://dapi.binance.com"):
        raise SystemExit("that host is not the one this pull measured")
    if "PriceUSD" in url or "ReferenceRateUSD" in url:
        raise SystemExit("a market price was requested")
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as res:
                return res.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 404 and missing_ok:
                return None
            if exc.code not in (418, 429, 500, 502, 503) or k + 1 == 6:
                raise
        except Exception as exc:
            last = exc
            if k + 1 == 6:
                raise
        time.sleep(1.0 * (k + 1))
    raise RuntimeError(f"get failed {last}")


def read_zip_rows(raw: bytes) -> list[list[str]]:
    zf = zipfile.ZipFile(io.BytesIO(raw))
    return list(csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())))


def months() -> list[str]:
    out = []
    y, m = 2024, 1
    while (y, m) <= (2026, 8):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def keep_bar(rows: dict[int, tuple[str, str]], ts: int, opened: str, closed: str) -> None:
    if ts < OOS_START or ts > EXIT_OPEN:
        return
    if Decimal(opened) <= 0 or Decimal(closed) <= 0:
        raise SystemExit("a bar is not a price")
    if ts in rows and rows[ts] != (opened, closed):
        if Decimal(rows[ts][0]) != Decimal(opened) or Decimal(rows[ts][1]) != Decimal(closed):
            raise SystemExit("two bars at one stamp")
    rows[ts] = (opened, closed)


def pull_book() -> dict[int, tuple[str, str]]:
    rows: dict[int, tuple[str, str]] = {}
    symbol = "ETHUSD_PERP"
    for ym in months():
        url = f"{VISION}/data/futures/cm/monthly/klines/{symbol}/1d/{symbol}-1d-{ym}.zip"
        raw = get(url)
        if raw is None:
            raise SystemExit(f"{ym} was not published")
        for row in read_zip_rows(raw):
            if not row or row[0] == "open_time":
                continue
            keep_bar(rows, int(row[0]), row[1], row[4])
    for day in range(1, 26):
        stamp = f"2026-09-{day:02d}"
        url = f"{VISION}/data/futures/cm/daily/klines/{symbol}/1d/{symbol}-1d-{stamp}.zip"
        raw = get(url, missing_ok=(day == 25))
        if raw is None:
            if day != 25:
                raise SystemExit(f"{stamp} was not published")
            continue
        for row in read_zip_rows(raw):
            if not row or row[0] == "open_time":
                continue
            ts = int(row[0])
            if ts != int(datetime(2026, 9, day, tzinfo=timezone.utc).timestamp() * 1000):
                raise SystemExit("the daily file holds another day")
            keep_bar(rows, ts, row[1], row[4])
    if EXIT_OPEN not in rows:
        end = EXIT_OPEN + c.fp5.DAY_MS - 1
        page = f"{LIVE}?symbol=ETHUSD_PERP&interval=1d&startTime={EXIT_OPEN}&endTime={end}&limit=5"
        batch = json.loads(get(page))
        kept = None
        for kline in batch:
            ts = int(kline[0])
            if ts > EXIT_OPEN:
                raise SystemExit("a bar after 2026-09-25 was returned")
            if ts == EXIT_OPEN:
                kept = (str(kline[1]), str(kline[4]))
        if kept is None:
            raise SystemExit("the 2026-09-25 open was not returned")
        keep_bar(rows, EXIT_OPEN, kept[0], kept[1])
    if min(rows) != OOS_START or max(rows) != EXIT_OPEN:
        raise SystemExit("the coin-margined window does not span the frozen days")
    if EXIT_OPEN + c.fp5.DAY_MS in rows:
        raise SystemExit("2026-09-26 was requested")
    path = DATA / "oos_cm1d" / "ETHUSD_PERP.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([[t, rows[t][0], rows[t][1]] for t in sorted(rows)], separators=(",", ":")))
    return rows


def pull_realized() -> dict[int, str]:
    url = (
        f"{COMMUNITY}?assets=eth&metrics={METRICS}"
        "&frequency=1d&start_time=2023-11-01&end_time=2026-09-23&page_size=10000"
    )
    rows: dict[int, str] = {}
    while url:
        payload = json.loads(get(url).decode())
        for row in payload["data"]:
            for key in ("CapMrktCurUSD", "CapMVRVCur", "SplyCur", "AssetEODCompletionTime"):
                if row.get(key) in (None, ""):
                    raise SystemExit("a realized-price input is missing")
            px = Decimal(row["CapMrktCurUSD"]) / Decimal(row["CapMVRVCur"]) / Decimal(row["SplyCur"])
            if px <= 0:
                raise SystemExit("a realized price is not a price")
            pub = int(row["AssetEODCompletionTime"]) * 1000
            if pub < c.fp5.SCREEN_END_MS or pub >= ENTRY_END:
                continue
            text = format(px, "f")
            if pub in rows and rows[pub] != text:
                raise SystemExit("two realized prices at one publication")
            rows[pub] = text
        url = payload.get("next_page_url") or ""
    if not rows:
        raise SystemExit("no realized price was published inside the window")
    path = DATA / "oos_realized" / "eth.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([[t, rows[t]] for t in sorted(rows)], separators=(",", ":")))
    return rows


def pull() -> None:
    require_frozen()
    if c.IDEA != "EREAL" or c.HOLD_DAYS != 2 or c.THRESHOLD_BPS != Decimal("1"):
        raise SystemExit("the frozen name, hold or threshold moved")
    book = pull_book()
    fair = pull_realized()
    print(f"fp321 oos book {len(book)} fair {len(fair)}", file=sys.stderr)


if __name__ == "__main__":
    pull()
