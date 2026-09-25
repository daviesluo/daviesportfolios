"""Pull 2023 DeFi TVL and confirm the ETH bars already on disk.

Rows on or after 2024-01-01 are dropped before the file is written.
Nothing from a later year is stored.

    python3 docs/agents/scripts/fp10/fetch.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

FP5 = Path(os.environ.get("FP5_DATA", "/tmp/fp5/data"))
FP10 = Path(os.environ.get("FP10_DATA", "/tmp/fp10/data"))
LOOKBACK_S = 1_664_582_400  # 2022-10-01 00:00 UTC
TVL_URL = "https://api.llama.fi/v2/historicalChainTvl"


def _rows(path: Path) -> list:
    if not path.exists():
        raise SystemExit(f"missing {path}")
    payload = json.loads(path.read_text())
    if not isinstance(payload, list):
        raise SystemExit(f"{path.name} is not a list")
    return payload


def pull_tvl() -> int:
    if os.environ.get("FP10_OOS"):
        raise SystemExit("this pull does not keep a later year")
    request = urllib.request.Request(TVL_URL, headers={"User-Agent": "fp10-screen"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.loads(response.read().decode())
    if not isinstance(payload, list):
        raise SystemExit("TVL payload is not a list")
    kept = []
    for row in payload:
        if "date" not in row or "tvl" not in row:
            raise SystemExit("a TVL row is missing date or tvl")
        stamp_s = int(row["date"])
        if stamp_s % 86_400 != 0:
            raise SystemExit("a TVL date is not midnight")
        stamp_ms = stamp_s * 1000
        if stamp_ms < LOOKBACK_S * 1000 or stamp_ms >= c.fp5.SCREEN_END_MS:
            continue
        value = float(row["tvl"])
        if value <= 0:
            continue
        kept.append([stamp_ms, value])
    kept.sort()
    FP10.mkdir(parents=True, exist_ok=True)
    (FP10 / "chain_tvl.json").write_text(json.dumps(kept, separators=(",", ":")))
    return len(kept)


def main() -> None:
    if os.environ.get("FP10_OOS"):
        raise SystemExit("this pull does not keep a later year")
    n = pull_tvl()
    for coin in ("ETHUSDT", "BTCUSDT"):
        rows = _rows(FP5 / "spot8h" / f"{coin}.json")
        if rows and max(int(row[0]) for row in rows) > c.fp5.PRICE_HORIZON_MS:
            raise SystemExit(f"{coin} 8h prices pass the screen horizon")
    daily = _rows(FP5 / "spot1d" / "BTCUSDT.json")
    if daily and max(int(row[0]) for row in daily) > c.fp5.PRICE_HORIZON_MS:
        raise SystemExit("BTC daily prices pass the screen horizon")
    print(f"tvl_rows {n} eth_8h {len(_rows(FP5 / 'spot8h' / 'ETHUSDT.json'))}")


if __name__ == "__main__":
    main()
