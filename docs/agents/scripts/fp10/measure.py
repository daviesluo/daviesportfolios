"""Score the fp10 screen. 2023 only.

    python3 docs/agents/scripts/fp10/measure.py
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
FP10 = Path(os.environ.get("FP10_DATA", "/tmp/fp10/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp10-protocol.md"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bars(path: Path) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {int(row[0]): tuple(float(x) for x in row[1:6]) for row in rows}
    c.fp5.assert_price_horizon(list(out))
    return out


def load_tvl(path: Path) -> list[tuple[int, float]]:
    rows = []
    for stamp, value in json.loads(path.read_text()):
        stamp = int(stamp)
        if stamp >= c.fp5.SCREEN_END_MS:
            raise RuntimeError("a TVL stamp is on or after 2024-01-01")
        rows.append((stamp, float(value)))
    return rows


def main() -> None:
    if os.environ.get("FP10_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    eth = load_bars(FP5 / "spot8h" / "ETHUSDT.json")
    btc8 = load_bars(FP5 / "spot8h" / "BTCUSDT.json")
    btc1 = load_bars(FP5 / "spot1d" / "BTCUSDT.json")
    tvl = load_tvl(FP10 / "chain_tvl.json")
    eight_pool = c.fp5.pool_from_bars({"BTCUSDT": btc8}, ["BTCUSDT"], c.fp5.EIGHT_H_MS)
    daily_pool = c.fp5.pool_from_bars({"BTCUSDT": btc1}, ["BTCUSDT"], c.fp5.DAY_MS)
    specs = [
        ("ETH-LEAD", c.eth_lead_trades(eth, btc8), eight_pool, "ETH 8h return above its own trailing 90th. Next 8h bar of BTC."),
        ("TVL-UP", c.tvl_trades(btc1, tvl), daily_pool, "DeFi TVL daily change above its own trailing 90th. Next day, one day."),
    ]
    rows = [c.fp5.summarise(name, trades, pool, c.MIN_N, note) for name, trades, pool, note in specs]
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp10_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp10_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {
            "eth_8h": sha256(FP5 / "spot8h" / "ETHUSDT.json"),
            "btc_8h": sha256(FP5 / "spot8h" / "BTCUSDT.json"),
            "btc_1d": sha256(FP5 / "spot1d" / "BTCUSDT.json"),
            "tvl": sha256(FP10 / "chain_tvl.json"),
        },
        "ideas": rows,
        "passed": [row["idea"] for row in rows if row["passes_screen"]],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp10/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
