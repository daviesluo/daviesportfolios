"""Pull the public series the fp122 screen is allowed to see.

The signal is one statistic of the BTCUSDT option book. Implied vol is not
stored. The bid and the ask are not stored. volume_usdt is not stored.
No hourly price bar is requested. No funding print is requested. No alt
quote is requested. No bookDepth file is requested. No BVOL file is
requested. ETH, BNB, DOGE and XRP option files are not requested.

    python3 docs/agents/scripts/fp122/fetch.py
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
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

DATA = Path(os.environ.get("FP122_DATA", "/tmp/fp122/data"))
CACHE = Path("/tmp/eoh-btc-cache")
VISION = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
MARKET = "https://data-api.binance.vision"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01 00:00 UTC
UA = {"User-Agent": "daviesportfolios-fp122-research"}
SPOT_FIELDS = (1,)
EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
EOH_HEADER = "date,hour,symbol,underlying,type,strike,open,high,low,close,volume_contracts,volume_usdt,best_bid_price,best_ask_price,best_bid_qty,best_ask_qty,best_buy_iv,best_sell_iv,mark_price,mark_iv,delta,gamma,vega,theta,openinterest_contracts,openinterest_usdt".split(",")
PREFIX = "data/option/daily/EOHSummary/BTCUSDT/"


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
        if isinstance(value, tuple):
            payload.append([t, *value])
        else:
            payload.append([t, value])
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


def list_days() -> list[str]:
    days = []
    marker = ""
    while True:
        url = VISION + "?prefix=" + PREFIX + "&max-keys=1000"
        if marker:
            url += "&marker=" + urllib.parse.quote(marker)
        xml = get(url).decode()
        keys = []
        for part in xml.split("<Key>")[1:]:
            keys.append(part.split("</Key>")[0])
        if not keys:
            break
        for key in keys:
            if not key.endswith(".zip"):
                continue
            ymd = key.rsplit("-", 1)[-1][:10]
            if ymd < "2022-10-01" or ymd >= "2024-01-01":
                continue
            days.append(ymd)
        if "<IsTruncated>true</IsTruncated>" not in xml:
            break
        marker = keys[-1]
    if not days:
        raise SystemExit("the option archive list was empty")
    if any(day >= "2024-01-01" for day in days):
        raise SystemExit("a 2024 option file was requested")
    return sorted(set(days))


def zip_bytes(ymd: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / (ymd + ".zip")
    if path.is_file() and path.stat().st_size > 0:
        return path.read_bytes()
    url = "https://data.binance.vision/" + PREFIX + "BTCUSDT-EOHSummary-" + ymd + ".zip"
    raw = get(url)
    tmp = path.with_suffix(".zip.part")
    tmp.write_bytes(raw)
    tmp.replace(path)
    return raw


def pull_options() -> dict[int, tuple]:
    days = list_days()
    out: dict[int, tuple] = {}
    for ymd in days:
        raw = zip_bytes(ymd)
        zf = zipfile.ZipFile(io.BytesIO(raw))
        names = zf.namelist()
        if len(names) != 1:
            raise SystemExit(ymd + " zip has the wrong members")
        text = zf.read(names[0]).decode()
        reader = csv.reader(io.StringIO(text))
        header = next(reader)
        if header != EOH_HEADER:
            raise SystemExit("the option header changed")
        file_ms = int(
            (datetime.datetime.strptime(ymd, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc) - EPOCH).total_seconds()
            * 1000
        )
        if file_ms >= c.fp5.SCREEN_END_MS:
            raise SystemExit("an option day is in 2024")
        seen = set()
        packed = []
        for row in reader:
            if not row or all(cell.strip() == "" for cell in row):
                continue
            if len(row) != len(EOH_HEADER):
                raise SystemExit(ymd + " has a short option row")
            if row[0] != ymd:
                raise SystemExit(ymd + " contains another date")
            if row[3] != "BTCUSDT":
                continue
            hour = num(row[1])
            if hour is None or hour != int(hour) or hour < 0 or hour > 23:
                raise SystemExit(ymd + " has an hour outside 0 to 23")
            parsed = c.parse_contract(row[2])
            if parsed is None:
                continue
            side = "P" if parsed[2] == 1 else "C"
            if row[4] != side:
                continue
            key = (int(hour), row[2])
            if key in seen:
                raise SystemExit(ymd + " repeats a contract in one hour")
            seen.add(key)
            out_rows = packed

            value = num(row[10])
            if value is None:
                continue
            out_rows.append((float(hour), float(parsed[2]), value))

        if not packed:
            continue
        flat = []
        for item in packed:
            flat.extend(item)
        out[file_ms] = tuple(flat)
    if any(t >= c.fp5.SCREEN_END_MS for t in out):
        raise SystemExit("an option day is in 2024")
    if not out:
        raise SystemExit("options came back empty")
    save("options/pc_vol.json", out)
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
    if os.environ.get("FP122_OOS"):
        raise SystemExit("this pull does not request a later year")
    options = pull_options()
    bars = pull_spot()
    print(
        "fp122 "
        + f"options {len(options)} first {min(options)} last {max(options)}"
        + "; "
        + f"BTCUSDT 1d {len(bars)} first {min(bars)} last {max(bars)}"
    )


if __name__ == "__main__":
    main()
