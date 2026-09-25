"""Pull the public series the fp6 screen is allowed to see.

BTC daily, BTC 8h and Binance funding are the fp5 screen files. This puller
does not touch them and does not request a bar after 2024-01-01 00:00 UTC.

    python3 docs/agents/scripts/fp6/fetch.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

_FP5 = Path(__file__).resolve().parents[1] / "fp5" / "common.py"
_spec = importlib.util.spec_from_file_location("fp5_common", _FP5)
fp5 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fp5)

DATA = Path(os.environ.get("FP6_DATA", "/tmp/fp6/data"))
MARKET = "https://data-api.binance.vision"
DERIBIT = "https://www.deribit.com/api/v2/public/get_funding_rate_history"
LOOKBACK_MS = 1_664_582_400_000  # 2022-10-01
UA = {"User-Agent": "daviesportfolios-fp6-research"}


def get_json(url: str) -> object:
    last = None
    for k in range(6):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.load(res)
        except Exception as exc:
            last = exc
            time.sleep(1.0 * (k + 1))
    raise RuntimeError(f"get failed {url} {last}")


def klines(symbol: str) -> dict[int, tuple]:
    end_ms = fp5.SCREEN_END_MS
    cursor = LOOKBACK_MS
    rows: dict[int, tuple] = {}
    while cursor <= end_ms:
        url = (
            f"{MARKET}/api/v3/klines?symbol={symbol}&interval=1d"
            f"&startTime={cursor}&endTime={end_ms}&limit=1000"
        )
        batch = get_json(url)
        if not batch:
            break
        for k in batch:
            open_ms = int(k[0])
            if open_ms < LOOKBACK_MS or open_ms > end_ms:
                continue
            rows[open_ms] = (float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[7]))
        last = int(batch[-1][0])
        nxt = last + fp5.DAY_MS
        if nxt <= cursor:
            break
        cursor = nxt
        if len(batch) < 1000:
            break
    if rows and max(rows) > fp5.PRICE_HORIZON_MS:
        raise RuntimeError(f"{symbol} returned a price past the horizon")
    return rows


def deribit_funding() -> tuple[dict[int, float], int]:
    """Hourly history, reduced to the 8h boundary. Stamps off the boundary are dropped."""
    kept: dict[int, float] = {}
    dropped = 0
    cursor = LOOKBACK_MS
    while cursor < fp5.SCREEN_END_MS:
        end = min(cursor + 30 * fp5.DAY_MS, fp5.SCREEN_END_MS)
        url = (
            f"{DERIBIT}?instrument_name=BTC-PERPETUAL"
            f"&start_timestamp={cursor}&end_timestamp={end - 1}"
        )
        body = get_json(url)
        result = body["result"]
        if not isinstance(result, list):
            raise RuntimeError("Deribit funding result was not a list")
        if not result:
            break
        last = cursor
        for row in result:
            ts = int(row["timestamp"])
            last = max(last, ts)
            if ts < LOOKBACK_MS or ts >= fp5.SCREEN_END_MS:
                dropped += 1
                continue
            if ts % fp5.EIGHT_H_MS != 0:
                dropped += 1
                continue
            if "interest_8h" not in row:
                raise RuntimeError("Deribit row has no interest_8h")
            kept[ts] = float(row["interest_8h"])
        nxt = last + 3_600_000
        if nxt <= cursor:
            break
        cursor = nxt
    return kept, dropped


def save(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")))


def main() -> None:
    for symbol in ("USDCUSDT", "BTCUSDC"):
        rows = klines(symbol)
        save(DATA / "spot1d" / f"{symbol}.json", [[t, *rows[t]] for t in sorted(rows)])
        print(f"{symbol} {len(rows)}", flush=True)
    kept, dropped = deribit_funding()
    save(DATA / "deribit_btc_funding.json", [[t, kept[t]] for t in sorted(kept)])
    print(f"deribit kept {len(kept)} dropped {dropped}", flush=True)


if __name__ == "__main__":
    main()
