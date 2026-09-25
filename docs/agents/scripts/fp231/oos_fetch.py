"""Pull the out-of-sample quarterlies named in the QNEW pre-registration.

Each symbol is stored from its listing through the UTC day before its
expiry. The expiry midnight is not stored. BTCUSD_261225 is not requested.
A symbol the venue does not publish is a skip, not a substitute. Refuses
to run until the pre-registration's sha256 matches.

    python3 docs/agents/scripts/fp231/oos_fetch.py
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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP231_DATA", "/tmp/fp231/data"))
PREREG = ROOT / "docs/agents/reviews/2026-09-25-fp231-prereg-qnew.md"
SIDECAR = ROOT / "docs/agents/reviews/2026-09-25-fp231-prereg-qnew.sha256"
VISION = "https://data.binance.vision"
UA = {"User-Agent": "daviesportfolios-fp231-research"}

# Listing midnight, expiry midnight, symbol. The first three are the screen.
LISTED = (
    (1_672_358_400_000, 1_688_083_200_000, "BTCUSD_230630"),
    (1_680_220_800_000, 1_695_945_600_000, "BTCUSD_230929"),
    (1_688_083_200_000, 1_703_808_000_000, "BTCUSD_231229"),
    (1_703_808_000_000, 1_711_670_400_000, "BTCUSD_240329"),
    (1_711_670_400_000, 1_719_532_800_000, "BTCUSD_240628"),
    (1_719_532_800_000, 1_727_395_200_000, "BTCUSD_240927"),
    (1_727_395_200_000, 1_735_257_600_000, "BTCUSD_241227"),
    (1_735_257_600_000, 1_743_120_000_000, "BTCUSD_250328"),
    (1_743_120_000_000, 1_750_982_400_000, "BTCUSD_250627"),
    (1_750_982_400_000, 1_758_844_800_000, "BTCUSD_250926"),
    (1_758_844_800_000, 1_766_707_200_000, "BTCUSD_251226"),
    (1_766_707_200_000, 1_774_569_600_000, "BTCUSD_260327"),
    (1_774_569_600_000, 1_782_432_000_000, "BTCUSD_260626"),
    (1_782_432_000_000, 1_790_294_400_000, "BTCUSD_260925"),
)
OOS_START = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require_frozen() -> None:
    if sha256(PREREG) != SIDECAR.read_text().strip():
        raise SystemExit("the pre-registration does not match its frozen sha256")
    text = PREREG.read_text()
    for listed, expiry, symbol in LISTED:
        if f"| {listed} | {expiry} | {symbol} |" not in text:
            raise SystemExit("the calendar is not the pre-registration")
    if "BTCUSD_261225" not in text or "is not an entry" not in text:
        raise SystemExit("the pre-registration no longer keeps the next listing out")


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


def read_zip_rows(raw: bytes) -> list[list[str]]:
    zf = zipfile.ZipFile(io.BytesIO(raw))
    return list(csv.reader(io.StringIO(zf.read(zf.namelist()[0]).decode())))


def keep_open(rows: dict[int, tuple], raw: bytes, listing: int, last: int, expiry: int, symbol: str) -> None:
    for row in read_zip_rows(raw):
        if not row or row[0] == "open_time":
            continue
        ts = int(row[0])
        if ts < listing or ts > last:
            continue
        if ts >= expiry:
            raise SystemExit(f"{symbol} returned its expiry")
        rows[ts] = (float(row[1]),)


def save(rel: str, rows: dict) -> None:
    path = DATA / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([[t, *rows[t]] for t in sorted(rows)], separators=(",", ":")))


def pull_symbol(symbol: str, listing: int, expiry: int) -> dict[int, tuple] | None:
    """Opens from the listing through the day before expiry. Expiry is not stored.

    Expired quarterlies are not on the live kline route. The monthly archive
    is the same contract, not a substitute. September 2026 has no monthly
    file yet, so those days are the daily archive.
    """
    last = expiry - c.fp5.DAY_MS
    if symbol == "BTCUSD_261225" or expiry > int(datetime(2026, 9, 25, tzinfo=timezone.utc).timestamp() * 1000):
        raise SystemExit("a later listing was requested")
    rows: dict[int, tuple] = {}
    start = datetime.fromtimestamp(listing / 1000, timezone.utc)
    stop = datetime.fromtimestamp(last / 1000, timezone.utc)
    y, m = start.year, start.month
    while (y, m) <= (stop.year, stop.month):
        ym = f"{y:04d}-{m:02d}"
        if ym == "2026-09":
            day = datetime(2026, 9, 1, tzinfo=timezone.utc)
            while day.date() <= stop.date():
                stamp = day.strftime("%Y-%m-%d")
                url = (
                    f"{VISION}/data/futures/cm/daily/klines/{symbol}/1d/"
                    f"{symbol}-1d-{stamp}.zip"
                )
                raw = get(url, missing_ok=True)
                if raw is not None:
                    keep_open(rows, raw, listing, last, expiry, symbol)
                day = datetime.fromtimestamp(day.timestamp() + c.fp5.DAY_MS / 1000, timezone.utc)
        else:
            url = (
                f"{VISION}/data/futures/cm/monthly/klines/{symbol}/1d/"
                f"{symbol}-1d-{ym}.zip"
            )
            raw = get(url, missing_ok=True)
            if raw is not None:
                keep_open(rows, raw, listing, last, expiry, symbol)
        m += 1
        if m == 13:
            y, m = y + 1, 1
    if any(day >= expiry for day in rows):
        raise SystemExit(f"{symbol} stored its expiry")
    return rows or None


def pull() -> list[str]:
    require_frozen()
    if LISTED[:3] != c.LISTED:
        raise SystemExit("the 2023 list moved")
    skipped = []
    for listing, expiry, symbol in LISTED[3:]:
        if expiry <= OOS_START:
            continue
        rows = pull_symbol(symbol, listing, expiry)
        if not rows:
            skipped.append(symbol)
            continue
        if max(rows) != expiry - c.fp5.DAY_MS:
            raise SystemExit(f"{symbol} does not stop the day before expiry")
        save(f"oos_cm1d/{symbol}.json", rows)
        print(f"fp231 oos {symbol} {len(rows)}", file=sys.stderr)
    return skipped


if __name__ == "__main__":
    skipped = pull()
    print("skipped " + (" ".join(skipped) if skipped else "none"), file=sys.stderr)
