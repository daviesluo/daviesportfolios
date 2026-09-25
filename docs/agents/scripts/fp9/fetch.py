"""Confirm the fp9 inputs are the 2023 files already on disk. Nothing is downloaded.

    python3 docs/agents/scripts/fp9/fetch.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

FP5 = Path(os.environ.get("FP5_DATA", "/tmp/fp5/data"))


def _rows(path: Path) -> list:
    if not path.exists():
        raise SystemExit(f"missing {path}")
    payload = json.loads(path.read_text())
    if not isinstance(payload, list):
        raise SystemExit(f"{path.name} is not a list")
    return payload


def _max_open(rows: list) -> int | None:
    if not rows:
        return None
    return max(int(row[0]) for row in rows)


def main() -> None:
    if os.environ.get("FP9_OOS"):
        raise SystemExit("this check does not pull a later year")
    dvol = _rows(FP5 / "dvol_btc.json")
    for row in dvol:
        stamp = int(row[0])
        if stamp % c.fp5.DAY_MS != 0 or stamp >= c.fp5.SCREEN_END_MS:
            raise SystemExit("a DVOL stamp is not a midnight before 2024")
    btc = _rows(FP5 / "spot1d" / "BTCUSDT.json")
    latest = _max_open(btc)
    if latest is None or latest > c.fp5.PRICE_HORIZON_MS:
        raise SystemExit("BTC daily prices pass the screen horizon")
    eight = 0
    for coin in c.fp5.BASKET:
        rows = _rows(FP5 / "spot8h" / f"{coin}.json")
        eight += 1
        last = _max_open(rows)
        if last is not None and last > c.fp5.PRICE_HORIZON_MS:
            raise SystemExit(f"{coin} 8h prices pass the screen horizon")
    print(f"dvol_rows {len(dvol)} btc_1d {len(btc)} spot8h_files {eight}")


if __name__ == "__main__":
    main()
