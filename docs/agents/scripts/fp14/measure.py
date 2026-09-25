"""Score the fp14 screen. 2023 only.

    python3 docs/agents/scripts/fp14/measure.py
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
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp14-protocol.md"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bars(path: Path) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {int(row[0]): tuple(float(x) for x in row[1:6]) for row in rows}
    c.fp5.assert_price_horizon(list(out))
    return out


def main() -> None:
    if os.environ.get("FP14_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    bars = {}
    inputs = {}
    for coin in c.fp5.BASKET:
        path = FP5 / "spot8h" / f"{coin}.json"
        if not path.is_file():
            raise SystemExit(f"missing {coin}")
        bars[coin] = load_bars(path)
        inputs[coin] = sha256(path)
    btc = bars["BTCUSDT"]
    pool = c.fp5.pool_from_bars({"BTCUSDT": btc}, ["BTCUSDT"], c.fp5.EIGHT_H_MS)
    row = c.fp5.summarise(
        "SKEW", c.skew_trades(bars), pool, c.MIN_N,
        "Basket 8h return skewness above its own trailing 90th. Next 8h bar of spot BTC.",
    )
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp14_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp14_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": inputs,
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp14/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
