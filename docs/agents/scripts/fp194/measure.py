"""Score the fp194 screen. 2023 entries only.

    python3 docs/agents/scripts/fp194/measure.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP194_DATA", "/tmp/fp194/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp194-protocol.md"
NOTE = 'The index close/open finished strictly above the spot close/open. Next day, short BTC from the open to the next open. The null is that short on every day.'
FIELDS = {"coin", "entry_ms", "exit_ms", "gross", "net", "pnl"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_rows(path: Path, width: int, last_ms: int, required: bool) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != width + 1:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts > last_ms:
            raise SystemExit(f"{path.name} goes past the window")
        out[ts] = tuple(float(x) for x in row[1:])
    if not out:
        raise SystemExit(path.name + " came back empty")
    if required and max(out) != last_ms:
        raise SystemExit(f"{path.name} stops on the wrong day")
    return out


def check_common(trade: dict) -> None:
    if set(trade) != FIELDS:
        raise SystemExit("a fill carries a field this rule does not use")
    if trade["coin"] != "BTCUSDT":
        raise SystemExit("a fill is not BTC")
    if not (c.fp5.SCREEN_START_MS <= trade["entry_ms"] < c.fp5.SCREEN_END_MS):
        raise SystemExit("a 2024 open was read as an entry")
    if abs(trade["pnl"] - 100.0 * trade["net"]) > 1e-9:
        raise SystemExit("the dollar result is not a hundred dollars times the net")


def assert_subset(trades: list[dict], pool: list[float]) -> None:
    if not trades:
        return
    if len(pool) <= len(trades):
        raise SystemExit("the null is not a larger pool than the rule")
    counts = Counter(pool)
    for trade in trades:
        if counts[trade["net"]] <= 0:
            raise SystemExit("a fill is not in the null pool")
        counts[trade["net"]] -= 1


def main() -> None:
    if os.environ.get("FP194_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    if c.IDEA != 'IDXSH' or c.MIN_N != 30:
        raise SystemExit("the frozen name or the count moved")

    end = c.fp5.SCREEN_END_MS
    bars = load_rows(DATA / "spot1d/BTCUSDT.json", 2, end, required=True)
    index = load_rows(DATA / "index1d/BTCUSDT.json", 2, c.SIGNAL_LAST_MS, required=True)
    trades = c.signal_trades(bars, index)
    for trade in trades:
        check_common(trade)
        if trade["exit_ms"] - trade["entry_ms"] != c.fp5.DAY_MS:
            raise SystemExit("the hold moved")
        day = trade["entry_ms"] - c.fp5.DAY_MS
        if day > c.SIGNAL_LAST_MS:
            raise SystemExit("the signal day is past the window")
        spot_open, spot_close = bars[day][0], bars[day][1]
        idx_open, idx_close = index[day]
        if not (idx_close / idx_open > spot_close / spot_open):
            raise SystemExit("a trade was not an index return above spot")
        entry_px = bars[trade["entry_ms"]][0]
        exit_px = bars[trade["exit_ms"]][0]
        if abs(trade["net"] - c.short_net(entry_px, exit_px)) > 1e-12:
            raise SystemExit("a fill is not the open-to-open short")
        if abs(trade["gross"] - (entry_px / exit_px - 1.0)) > 1e-12:
            raise SystemExit("the gross is not the short")
    pool = c.pool_nets(bars)
    assert_subset(trades, pool)

    row = c.fp5.summarise(c.IDEA, trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp194_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp194_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {"spot": sha256(DATA / "spot1d/BTCUSDT.json"), "index": sha256(DATA / "index1d/BTCUSDT.json")},
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp194/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
