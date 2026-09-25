"""Score the fp13 screen. 2023 only.

    python3 docs/agents/scripts/fp13/measure.py
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
FP13 = Path(os.environ.get("FP13_DATA", "/tmp/fp13/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp13-protocol.md"


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
            raise RuntimeError(f"{path.name} has a stamp that is not a midnight before 2024")
        rows.append((stamp, float(value)))
    return rows


def main() -> None:
    if os.environ.get("FP13_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    btc_px = load_bars(FP5 / "spot1d" / "BTCUSDT.json")
    btc = load_dvol(FP5 / "dvol_btc.json")
    eth = load_dvol(FP13 / "dvol_eth.json")
    pool = c.fp5.pool_from_bars({"BTCUSDT": btc_px}, ["BTCUSDT"], c.fp5.DAY_MS)
    row = c.fp5.summarise(
        "IV-SPREAD", c.spread_trades(btc_px, btc, eth), pool, c.MIN_N,
        "ETH DVOL minus BTC DVOL, above its own trailing 90th. Next day, one day.",
    )
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp13_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp13_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {
            "btc_dvol": sha256(FP5 / "dvol_btc.json"),
            "eth_dvol": sha256(FP13 / "dvol_eth.json"),
            "btc_1d": sha256(FP5 / "spot1d" / "BTCUSDT.json"),
        },
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp13/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
