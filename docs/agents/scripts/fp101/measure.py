"""Score the fp101 screen. 2023 only.

    python3 docs/agents/scripts/fp101/measure.py
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
DATA = Path(os.environ.get("FP101_DATA", "/tmp/fp101/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp101-protocol.md"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bars(path: Path, width: int) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != width:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        out[int(row[0])] = tuple(float(x) for x in row[1:])
    if not out:
        raise SystemExit(f"{path.name} is empty")
    return out


def main() -> None:
    if os.environ.get("FP101_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")

    alt_path = DATA / "spot1d" / "LINKUSDT.json"
    btc_path = DATA / "spot1d" / "BTCUSDT.json"
    if not alt_path.is_file() or not btc_path.is_file():
        raise SystemExit("missing bars")
    alt = load_bars(alt_path, 3)
    btc = load_bars(btc_path, 3)
    if max(alt) > c.fp5.SCREEN_END_MS or max(btc) > c.fp5.SCREEN_END_MS:
        raise SystemExit("a daily bar opened after 2024-01-01")
    trades = c.relq_trades(alt, btc)

    c.fp5.assert_price_horizon(list(alt))
    for trade in trades:
        if trade["coin"] != "LINKUSDT":
            raise SystemExit("a fill is not LINK")
        entry = alt[trade["entry_ms"]][0]
        exit_ = alt[trade["exit_ms"]][0]
        if abs(trade["net"] - c.fp5.net_return(entry, exit_)) > 1e-12:
            raise SystemExit("a fill is not fp5's")
    pool = c.fp5.pool_from_bars({"LINKUSDT": alt}, ["LINKUSDT"], c.fp5.DAY_MS)
    row = c.fp5.summarise(
        "LINK-Q", trades, pool, c.MIN_N,
        "LINK's daily quote volume over BTC's, above its own trailing 90th. Next day, long LINK.",
    )
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp101_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp101_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {"alt_1d": sha256(alt_path), "btc_1d": sha256(btc_path)},
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp101/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
