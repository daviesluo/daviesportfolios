"""Score the fp21 screen. 2023 only.

    python3 docs/agents/scripts/fp21/measure.py
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
DATA = Path(os.environ.get("FP21_DATA", "/tmp/fp21/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp21-protocol.md"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bars(path: Path) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 5:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        out[int(row[0])] = tuple(float(x) for x in row[1:5])
    if not out:
        raise SystemExit(f"{path.name} is empty")
    if max(out) > c.fp5.SCREEN_END_MS:
        raise SystemExit(f"{path.name} opened after 2024-01-01")
    c.fp5.assert_price_horizon(list(out))
    return out


def main() -> None:
    if os.environ.get("FP21_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    btc_path = DATA / "spot1d" / "BTCUSDT.json"
    if not btc_path.is_file():
        raise SystemExit("missing daily bars")
    btc = load_bars(btc_path)
    pool = c.fp5.pool_from_bars({"BTCUSDT": btc}, ["BTCUSDT"], c.fp5.DAY_MS)
    row = c.fp5.summarise(
        "VWAP-PREM", c.prem_trades(btc), pool, c.MIN_N,
        "Close above the day's VWAP, above its own trailing 90th. Next day, long BTC.",
    )
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp21_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp21_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {"btc_1d": sha256(btc_path)},
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp21/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
