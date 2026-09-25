"""Pull the two Coin Metrics series the fp7 screen is allowed to see.

Stops at 2024-01-01. BTC and ETH bars are the fp5 screen files.

    python3 docs/agents/scripts/fp7/fetch.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "fp5_common",
    Path(__file__).resolve().parents[1] / "fp5" / "common.py",
)
fp5 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fp5)

DATA = Path(os.environ.get("FP7_DATA", "/tmp/fp7/data"))
BASE = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
UA = {"User-Agent": "daviesportfolios-fp7-research"}
# The last signal day that can still be history. An entry on this midnight is
# 2024 and the scorer refuses it.
END_TIME = "2024-01-01"


def get_json(url: str) -> dict:
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as res:
                body = json.load(res)
            if not isinstance(body, dict):
                raise RuntimeError("Coin Metrics did not return an object")
            return body
        except Exception as exc:
            last = exc
            time.sleep(1.0 * (k + 1))
    raise RuntimeError(f"get failed {last}")


def day_ms(stamp: str) -> int:
    if len(stamp) < 10 or stamp[4] != "-" or stamp[7] != "-":
        raise RuntimeError(f"Coin Metrics time is not YYYY-MM-DD: {stamp[:16]}")
    y, m, d = (int(stamp[0:4]), int(stamp[5:7]), int(stamp[8:10]))
    return int(datetime(y, m, d, tzinfo=timezone.utc).timestamp() * 1000)


def pull(metric: str) -> list[list]:
    url = (
        f"{BASE}?assets=btc&metrics={metric}&frequency=1d"
        f"&start_time=2022-10-01&end_time={END_TIME}&page_size=10000"
    )
    rows: dict[int, float] = {}
    pages = 0
    while url:
        pages += 1
        if pages > 10:
            raise RuntimeError("Coin Metrics pagination did not end")
        body = get_json(url)
        for row in body.get("data") or []:
            if metric not in row or row[metric] is None:
                continue
            ts = day_ms(str(row["time"]))
            if ts < 1_664_582_400_000 or ts >= fp5.SCREEN_END_MS:
                continue
            rows[ts] = float(row[metric])
        url = body.get("next_page_url") or ""
    if any(ts >= fp5.SCREEN_END_MS for ts in rows):
        raise RuntimeError("a 2024 metric survived the filter")
    return [[ts, rows[ts]] for ts in sorted(rows)], pages


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    for metric in ("CapMVRVCur", "AdrActCnt"):
        rows, pages = pull(metric)
        path = DATA / f"{metric}.json"
        path.write_text(json.dumps(rows, separators=(",", ":")))
        print(f"{metric} {len(rows)} pages {pages}", flush=True)


if __name__ == "__main__":
    main()
