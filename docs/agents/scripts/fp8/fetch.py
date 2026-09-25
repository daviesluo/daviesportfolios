"""Pull the public series the fp8 screen is allowed to see.

Stops before 2024-01-01. BTC spot is the fp5 screen file.

    python3 docs/agents/scripts/fp8/fetch.py
"""

from __future__ import annotations

import importlib.util
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

_spec = importlib.util.spec_from_file_location(
    "fp5_common",
    Path(__file__).resolve().parents[1] / "fp5" / "common.py",
)
fp5 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fp5)

DATA = Path(os.environ.get("FP8_DATA", "/tmp/fp8/data"))
CM = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
VISION = "https://data.binance.vision/data/futures/um/monthly/klines"
UA = {"User-Agent": "daviesportfolios-fp8-research"}
LOOKBACK_MS = 1_664_582_400_000


def get_bytes(url: str) -> bytes | None:
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            last = exc
            time.sleep(1.0 * (k + 1))
        except Exception as exc:
            last = exc
            time.sleep(1.0 * (k + 1))
    raise RuntimeError(f"get failed {url} {last}")


def day_ms(stamp: str) -> int:
    if len(stamp) < 10 or stamp[4] != "-" or stamp[7] != "-":
        raise RuntimeError(f"time is not YYYY-MM-DD: {stamp[:16]}")
    y, m, d = int(stamp[0:4]), int(stamp[5:7]), int(stamp[8:10])
    return int(datetime(y, m, d, tzinfo=timezone.utc).timestamp() * 1000)


def pull_metric(metric: str) -> list[list]:
    url = (
        f"{CM}?assets=btc&metrics={metric}&frequency=1d"
        f"&start_time=2022-10-01&end_time=2024-01-01&page_size=10000"
    )
    rows: dict[int, float] = {}
    pages = 0
    while url:
        pages += 1
        if pages > 10:
            raise RuntimeError("pagination did not end")
        body = json.loads(get_bytes(url))
        for row in body.get("data") or []:
            if row.get(metric) is None:
                continue
            ts = day_ms(str(row["time"]))
            if ts < LOOKBACK_MS or ts >= fp5.SCREEN_END_MS:
                continue
            rows[ts] = float(row[metric])
        url = body.get("next_page_url") or ""
    return [[ts, rows[ts]] for ts in sorted(rows)], pages


def months() -> list[str]:
    out = []
    y, m = 2022, 10
    while (y, m) <= (2023, 12):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def pull_futures() -> dict[str, list[list]]:
    books: dict[str, dict[int, float]] = {}
    missed = 0
    for exp, sym in c.CONTRACTS:
        books[str(exp)] = {}
        for ym in months():
            url = f"{VISION}/{sym}/1d/{sym}-1d-{ym}.zip"
            raw = get_bytes(url)
            if raw is None:
                missed += 1
                continue
            zf = zipfile.ZipFile(io.BytesIO(raw))
            for line in zf.read(zf.namelist()[0]).decode().splitlines():
                parts = line.split(",")
                if not parts or not parts[0].isdigit():
                    continue
                ts = int(parts[0])
                if ts < LOOKBACK_MS or ts >= fp5.SCREEN_END_MS:
                    continue
                if len(parts) < 5:
                    raise RuntimeError(f"{sym} {ym} has no close column")
                books[str(exp)][ts] = float(parts[4])
    return {exp: [[ts, rows[ts]] for ts in sorted(rows)] for exp, rows in books.items()}, missed


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    for metric in ("FlowInExNtv", "FlowOutExNtv", "HashRate"):
        rows, pages = pull_metric(metric)
        (DATA / f"{metric}.json").write_text(json.dumps(rows, separators=(",", ":")))
        print(f"{metric} {len(rows)} pages {pages}", flush=True)
    books, missed = pull_futures()
    (DATA / "futures.json").write_text(json.dumps(books, separators=(",", ":")))
    counts = {k: len(v) for k, v in books.items()}
    print(f"futures {counts} missed_months {missed}", flush=True)


if __name__ == "__main__":
    main()
