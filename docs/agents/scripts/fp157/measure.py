"""Score the fp157 screen. 2023 entries only.

    python3 docs/agents/scripts/fp157/measure.py
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
DATA = Path(os.environ.get("FP157_DATA", "/tmp/fp157/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp157-protocol.md"
NOTE = "The spot close is above the close five days earlier. Next open, long BTC for two days."


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_rows(path: Path, width: int, last_ms: int) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != width + 1:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts > last_ms:
            raise SystemExit(f"{path.name} goes past the exit window")
        out[ts] = tuple(float(x) for x in row[1:])
    if not out:
        raise SystemExit(f"{path.name} is empty")
    return out


def main() -> None:
    if os.environ.get("FP157_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    last = c.fp5.SCREEN_END_MS + c.fp5.DAY_MS
    bars = load_rows(DATA / "spot1d/BTCUSDT.json", 2, last)
    if max(bars) != last:
        raise SystemExit("the daily grid does not stop on 2024-01-02")
    trades = c.signal_trades(bars)
    for trade in trades:
        if trade["exit_ms"] - trade["entry_ms"] != 2 * c.fp5.DAY_MS:
            raise SystemExit("the hold is not two days")
        signal = trade["entry_ms"] - c.fp5.DAY_MS
        earlier = signal - 5 * c.fp5.DAY_MS
        if bars[signal][1] <= bars[earlier][1]:
            raise SystemExit("a trade was not a higher close five days back")
        if abs(trade["net"] - c.fp5.net_return(bars[trade["entry_ms"]][0], bars[trade["exit_ms"]][0])) > 1e-12:
            raise SystemExit("a fill did not use the two opens")
    pool = c.pool_nets(bars)
    row = c.fp5.summarise("MOM5", trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp157_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp157_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {
            "spot_oc": sha256(DATA / "spot1d/BTCUSDT.json"),
        },
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp157/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
