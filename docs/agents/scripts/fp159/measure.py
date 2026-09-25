"""Score the fp159 screen. 2023 entries only.

    python3 docs/agents/scripts/fp159/measure.py
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
DATA = Path(os.environ.get("FP159_DATA", "/tmp/fp159/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp159-protocol.md"
NOTE = "The 00:00 funding rate is strictly above the 08:00 and 16:00 rates. Next day, long BTC for one day."


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


def load_funding(path: Path) -> list[tuple[int, float]]:
    rows = json.loads(path.read_text())
    out = []
    for row in rows:
        if len(row) != 2:
            raise SystemExit("funding carries a field this rule does not use")
        ts = int(row[0])
        if ts >= c.fp5.SCREEN_END_MS + c.fp5.DAY_MS:
            raise SystemExit("a funding print is past 2024-01-01")
        out.append((ts, float(row[1])))
    if not out:
        raise SystemExit("funding is empty")
    return out


def main() -> None:
    if os.environ.get("FP159_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    end = c.fp5.SCREEN_END_MS
    bars = load_rows(DATA / "spot1d/BTCUSDT.json", 1, end)
    funding = c.funding_hours(load_funding(DATA / "funding/BTCUSDT.json"))
    if max(bars) != end:
        raise SystemExit("the daily grid does not stop on 2024-01-01")
    trades = c.signal_trades(funding, bars)
    for trade in trades:
        if trade["exit_ms"] - trade["entry_ms"] != c.fp5.DAY_MS:
            raise SystemExit("the hold moved")
        rates = funding[trade["entry_ms"] - c.fp5.DAY_MS]
        if not (rates[0] > rates[1] and rates[0] > rates[2]):
            raise SystemExit("a long was not the richest 00:00 rate")
        if abs(trade["net"] - c.fp5.net_return(bars[trade["entry_ms"]][0], bars[trade["exit_ms"]][0])) > 1e-12:
            raise SystemExit("a fill is not fp5's")
    pool = c.pool_nets(bars)
    row = c.fp5.summarise("PEAK0", trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp159_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp159_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {
            "spot_open": sha256(DATA / "spot1d/BTCUSDT.json"),
            "funding": sha256(DATA / "funding/BTCUSDT.json"),
        },
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp159/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
