"""Score the fp128 screen. 2023 entries only. The hold is one day.

    python3 docs/agents/scripts/fp128/measure.py
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
DATA = Path(os.environ.get("FP128_DATA", "/tmp/fp128/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp128-protocol.md"
NOTE = "Last unspent-output count of the UTC day, above its own trailing 90th. Next day, long BTC for one day."


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_book(path: Path) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) < 3 or (len(row) - 1) % 2 != 0:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts >= c.fp5.SCREEN_END_MS:
            raise SystemExit("a signal is in 2024")
        out[ts] = tuple(float(x) for x in row[1:])
    if not out:
        raise SystemExit(f"{path.name} is empty")
    return out


def load_spot(path: Path) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 2:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts > c.fp5.SCREEN_END_MS:
            raise SystemExit("a daily bar opened after 2024-01-01")
        out[ts] = (float(row[1]),)
    if not out:
        raise SystemExit(f"{path.name} is empty")
    return out


def main() -> None:
    if os.environ.get("FP128_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    signal = load_book(DATA / "utxo/count.json")
    bars = load_spot(DATA / "spot1d" / "BTCUSDT.json")
    if max(signal) >= c.fp5.SCREEN_END_MS:
        raise SystemExit("a signal day is in 2024")
    if max(bars) != c.fp5.SCREEN_END_MS:
        raise SystemExit("the daily grid does not stop on 2024-01-01")
    c.fp5.assert_price_horizon(list(bars))
    trades = c.signal_trades(signal, bars)
    for trade in trades:
        if trade["coin"] != "BTCUSDT":
            raise SystemExit("a fill is not BTC")
        if trade["exit_ms"] - trade["entry_ms"] != c.fp5.DAY_MS:
            raise SystemExit("the hold moved")
        entry = bars[trade["entry_ms"]][0]
        exit_ = bars[trade["exit_ms"]][0]
        if abs(trade["net"] - c.fp5.net_return(entry, exit_)) > 1e-12:
            raise SystemExit("a fill is not fp5's")
    pool = c.fp5.pool_from_bars({"BTCUSDT": bars}, ["BTCUSDT"], c.fp5.DAY_MS)
    row = c.fp5.summarise("UTXO", trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp128_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp128_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {
            "utxo": sha256(DATA / "utxo/count.json"),
            "btc_1d": sha256(DATA / "spot1d" / "BTCUSDT.json"),
        },
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp128/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
