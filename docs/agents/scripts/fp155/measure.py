"""Score the fp155 screen. 2023 entries only.

    python3 docs/agents/scripts/fp155/measure.py
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
DATA = Path(os.environ.get("FP155_DATA", "/tmp/fp155/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp155-protocol.md"
NOTE = "The last taker ratio is above one. Next day, long BTC from the open to that day's close."


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
    if os.environ.get("FP155_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    end = c.fp5.SCREEN_END_MS
    taker = load_rows(DATA / "taker/last.json", 1, end - c.fp5.DAY_MS)
    bars = load_rows(DATA / "spot1d/BTCUSDT.json", 2, end)
    if max(bars) != end:
        raise SystemExit("the daily grid does not stop on 2024-01-01")
    trades = c.signal_trades(taker, bars)
    for trade in trades:
        if trade["exit_ms"] != trade["entry_ms"]:
            raise SystemExit("the session ran past the close")
        signal = trade["entry_ms"] - c.fp5.DAY_MS
        if signal not in taker or taker[signal][0] <= 1.0:
            raise SystemExit("a session was not decided by a ratio above one")
        open_px, close_px = bars[trade["entry_ms"]]
        if abs(trade["net"] - c.fp5.net_return(open_px, close_px)) > 1e-12:
            raise SystemExit("a fill did not sell the close")
    pool = c.pool_nets(bars)
    row = c.fp5.summarise("TAKSESS", trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp155_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp155_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {
            "taker_last": sha256(DATA / "taker/last.json"),
            "spot_session": sha256(DATA / "spot1d/BTCUSDT.json"),
        },
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp155/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
