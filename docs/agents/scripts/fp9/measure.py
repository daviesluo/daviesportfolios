"""Score the fp9 screen. 2023 only.

    python3 docs/agents/scripts/fp9/measure.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

ROOT = Path(__file__).resolve().parents[4]
FP5 = Path(os.environ.get("FP5_DATA", "/tmp/fp5/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp9-protocol.md"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bars(path: Path) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {int(row[0]): tuple(float(x) for x in row[1:6]) for row in rows}
    c.fp5.assert_price_horizon(list(out))
    return out


def load_dvol(path: Path) -> list[tuple[int, float]]:
    rows = []
    for stamp, value in json.loads(path.read_text()):
        stamp = int(stamp)
        if stamp % c.fp5.DAY_MS != 0 or stamp >= c.fp5.SCREEN_END_MS:
            raise RuntimeError("a DVOL stamp is not a midnight before 2024")
        rows.append((stamp, float(value)))
    return rows


def main() -> None:
    if os.environ.get("FP9_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    btc = load_bars(FP5 / "spot1d" / "BTCUSDT.json")
    dvol = load_dvol(FP5 / "dvol_btc.json")
    spot8 = {coin: load_bars(FP5 / "spot8h" / f"{coin}.json") for coin in c.fp5.BASKET}
    daily_pool = c.fp5.pool_from_bars({"BTCUSDT": btc}, ["BTCUSDT"], c.fp5.DAY_MS)
    eight_pool = c.fp5.pool_from_bars({"BTCUSDT": spot8["BTCUSDT"]}, ["BTCUSDT"], c.fp5.EIGHT_H_MS)
    specs = [
        ("VRP", c.vrp_trades(btc, dvol), daily_pool, "DVOL minus 30-day realized, above its own trailing 90th. Next day, one day."),
        ("DISPERSION", c.dispersion_trades(spot8), eight_pool, "Basket 8h dispersion above its own trailing 90th. Next 8h bar of BTC."),
    ]
    rows = [c.fp5.summarise(name, trades, pool, c.MIN_N, note) for name, trades, pool, note in specs]
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp9_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp9_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {
            "btc_1d": sha256(FP5 / "spot1d" / "BTCUSDT.json"),
            "dvol": sha256(FP5 / "dvol_btc.json"),
            **{f"spot8h_{coin}": sha256(FP5 / "spot8h" / f"{coin}.json") for coin in c.fp5.BASKET},
        },
        "ideas": rows,
        "passed": [row["idea"] for row in rows if row["passes_screen"]],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp9/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
