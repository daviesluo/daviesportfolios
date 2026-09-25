"""Score the fp160 screen. 2023 entries only.

    python3 docs/agents/scripts/fp160/measure.py
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
DATA = Path(os.environ.get("FP160_DATA", "/tmp/fp160/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp160-protocol.md"
NOTE = "The taker ratio crosses up through one. Long BTC until a later last print is back at or under one, at most five days."


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
    if os.environ.get("FP160_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    taker_last = c.fp5.SCREEN_END_MS + 3 * c.fp5.DAY_MS
    price_last = c.fp5.SCREEN_END_MS + 4 * c.fp5.DAY_MS
    taker = load_rows(DATA / "taker/last.json", 1, taker_last)
    bars = load_rows(DATA / "spot1d/BTCUSDT.json", 1, price_last)
    if max(bars) != price_last:
        raise SystemExit("the daily grid does not stop on 2024-01-05")
    if max(taker) != taker_last:
        raise SystemExit("the taker file does not stop on 2024-01-04")
    values = {day: taker[day][0] for day in taker}
    trades = c.signal_trades(taker, bars)
    for trade in trades:
        held = (trade["exit_ms"] - trade["entry_ms"]) // c.fp5.DAY_MS
        if held < 1 or held > c.MAX_HOLD:
            raise SystemExit("the hold left one to five days")
        cross = trade["entry_ms"] - c.fp5.DAY_MS
        prev = cross - c.fp5.DAY_MS
        if not (values[prev] <= 1.0 and values[cross] > 1.0):
            raise SystemExit("a trade was not a cross up through one")
        if trade["exit_ms"] != c.hold_exit(values, trade["entry_ms"]):
            raise SystemExit("the exit is not the ratio's return")
        if abs(trade["net"] - c.fp5.net_return(bars[trade["entry_ms"]][0], bars[trade["exit_ms"]][0])) > 1e-12:
            raise SystemExit("a fill is not fp5's")
    pool = c.pool_nets(taker, bars)
    row = c.fp5.summarise("TAKX", trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp160_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp160_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {
            "taker_last": sha256(DATA / "taker/last.json"),
            "spot_open": sha256(DATA / "spot1d/BTCUSDT.json"),
        },
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp160/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
