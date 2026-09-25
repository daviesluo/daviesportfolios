"""Score the fp12 screen. 2023 only.

    python3 docs/agents/scripts/fp12/measure.py
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
FP12 = Path(os.environ.get("FP12_DATA", "/tmp/fp12/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp12-protocol.md"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bars(path: Path) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {int(row[0]): tuple(float(x) for x in row[1:6]) for row in rows}
    c.fp5.assert_price_horizon(list(out))
    return out


def main() -> None:
    if os.environ.get("FP12_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    dom = load_bars(FP12 / "dom8h.json")
    btc = load_bars(FP5 / "spot8h" / "BTCUSDT.json")
    if any(ts >= c.fp5.SCREEN_END_MS for ts in dom):
        raise RuntimeError("a dominance bar opens on or after 2024-01-01")
    pool = c.fp5.pool_from_bars({"BTCUSDT": btc}, ["BTCUSDT"], c.fp5.EIGHT_H_MS)
    row = c.fp5.summarise(
        "DOM-UP", c.dom_trades(dom, btc), pool, c.MIN_N,
        "BTCDOM 8h return above its own trailing 90th. Next 8h bar of spot BTC.",
    )
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp12_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp12_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {
            "dom_8h": sha256(FP12 / "dom8h.json"),
            "btc_8h": sha256(FP5 / "spot8h" / "BTCUSDT.json"),
        },
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp12/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
