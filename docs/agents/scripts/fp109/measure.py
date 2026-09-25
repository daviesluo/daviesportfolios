"""Score the fp109 screen. 2023 entries only. The hold is 10 days.

    python3 docs/agents/scripts/fp109/measure.py
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
DATA = Path(os.environ.get("FP109_DATA", "/tmp/fp109/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp109-protocol.md"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_bars(path: Path) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 2:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        out[int(row[0])] = (float(row[1]),)
    if not out:
        raise SystemExit(f"{path.name} is empty")
    return out


def load_funding(path: Path) -> dict[int, float]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 2:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts >= c.fp5.SCREEN_END_MS:
            raise SystemExit("a funding print is in 2024")
        out[ts] = float(row[1])
    if not out:
        raise SystemExit(f"{path.name} is empty")
    return out


def main() -> None:
    if os.environ.get("FP109_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    bar_path = DATA / "spot1d" / "BTCUSDT.json"
    fund_path = DATA / "funding" / "BTCUSDT.json"
    if not bar_path.is_file() or not fund_path.is_file():
        raise SystemExit("missing bars")
    bars = load_bars(bar_path)
    funding = load_funding(fund_path)
    if max(bars) != c.EXIT_HORIZON_MS or any(t > c.EXIT_HORIZON_MS for t in bars):
        raise SystemExit("the daily grid does not stop on 2024-01-14")
    trades = c.frng_trades(funding, bars)
    for trade in trades:
        if trade["coin"] != "BTCUSDT":
            raise SystemExit("a fill is not BTC")
        if trade["exit_ms"] - trade["entry_ms"] != c.HOLD_DAYS * c.fp5.DAY_MS:
            raise SystemExit("the hold moved")
        entry = bars[trade["entry_ms"]][0]
        exit_ = bars[trade["exit_ms"]][0]
        if abs(trade["net"] - c.fp5.net_return(entry, exit_)) > 1e-12:
            raise SystemExit("a fill is not fp5's")
    pool = c.fp5.pool_from_bars({"BTCUSDT": bars}, ["BTCUSDT"], c.HOLD_DAYS * c.fp5.DAY_MS)
    row = c.fp5.summarise(
        "FRNG-10", trades, pool, c.MIN_N,
        "Range of BTC's three funding prints, above its own trailing 90th. "
        "Next day, long BTC for 10 days.",
    )
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp109_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp109_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {
            "btc_1d": sha256(bar_path),
            "funding": sha256(fund_path),
        },
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp109/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
