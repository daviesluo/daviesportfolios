"""Score the fp7 screen. 2023 only.

    python3 docs/agents/scripts/fp7/measure.py
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
FP7 = Path(os.environ.get("FP7_DATA", "/tmp/fp7/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp7-protocol.md"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bars(path: Path) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {int(r[0]): tuple(float(x) for x in r[1:6]) for r in rows}
    c.fp5.assert_price_horizon(list(out))
    return out


def load_points(path: Path) -> list[tuple[int, float]]:
    rows = [(int(r[0]), float(r[1])) for r in json.loads(path.read_text())]
    late = [t for t, _ in rows if t >= c.fp5.SCREEN_END_MS]
    if late:
        raise RuntimeError(f"{path.name} has a 2024 stamp")
    return rows


def main() -> None:
    if os.environ.get("FP7_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    btc = load_bars(FP5 / "spot1d" / "BTCUSDT.json")
    eth = load_bars(FP5 / "spot1d" / "ETHUSDT.json")
    mvrv = load_points(FP7 / "CapMVRVCur.json")
    addr = load_points(FP7 / "AdrActCnt.json")
    pool = c.fp5.pool_from_bars({"BTCUSDT": btc}, ["BTCUSDT"], c.fp5.DAY_MS)
    specs = [
        ("MVRV", c.forward(btc, c.mvrv_days(mvrv))),
        ("ADDR", c.forward(btc, c.upper_tail_days(addr))),
        ("BTC-SHARE", c.forward(btc, c.btc_share_days(btc, eth))),
    ]
    rows = [c.fp5.summarise(name, trades, pool, c.MIN_N, "candidate") for name, trades in specs]
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp7_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp7_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {
            "btc_1d": sha256(FP5 / "spot1d" / "BTCUSDT.json"),
            "eth_1d": sha256(FP5 / "spot1d" / "ETHUSDT.json"),
            "mvrv": sha256(FP7 / "CapMVRVCur.json"),
            "addr": sha256(FP7 / "AdrActCnt.json"),
        },
        "ideas": rows,
        "passed": [r["idea"] for r in rows if r["passes_screen"]],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp7/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
