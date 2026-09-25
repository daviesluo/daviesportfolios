"""Score the fp206 screen. 2023 entries only.

    python3 docs/agents/scripts/fp206/measure.py
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
DATA = Path(os.environ.get("FP206_DATA", "/tmp/fp206/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp206-protocol.md"
NOTE = "The 00:00 coin-margined funding rate is strictly negative and the 16:00 rate is strictly positive. That day's close is sold and the next open is bought. Funding cash is not added. The null is that overnight short on every day."
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



def load_funding() -> dict[int, float]:
    raw = json.loads((DATA / "funding/BTCUSD_PERP.json").read_text())
    funding = {}
    end = c.fp5.SCREEN_END_MS
    floor = end - c.fp5.DAY_MS - c.fp5.EIGHT_H_MS
    last_legal = end - c.fp5.EIGHT_H_MS
    for row in raw:
        if len(row) != 2:
            raise SystemExit("funding carries a field this rule does not use")
        ts = int(row[0])
        if ts >= end or ts > last_legal:
            raise SystemExit("a 2024 funding print was stored")
        if ts % c.fp5.DAY_MS not in (0, 2 * c.fp5.EIGHT_H_MS):
            raise SystemExit("a funding print is not 00:00 or 16:00")
        funding[ts] = float(row[1])
    if not funding or floor not in funding or (floor - 2 * c.fp5.EIGHT_H_MS) not in funding:
        raise SystemExit("the last published day is missing a print")
    return funding


def main() -> None:
    if os.environ.get("FP206_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    if c.IDEA != "CMFN" or c.MIN_N != 30:
        raise SystemExit("the frozen name or the count moved")

    end = c.fp5.SCREEN_END_MS
    bars = load_rows(DATA / "cm1d/BTCUSD_PERP.json", 2, end, required=True)
    funding = load_funding()
    trades = c.signal_trades(bars, funding)
    for trade in trades:
        check_common(trade)
        if trade["exit_ms"] - trade["entry_ms"] != c.fp5.DAY_MS:
            raise SystemExit("the hold moved")
        day = trade["entry_ms"]
        if day > c.ENTRY_LAST_MS:
            raise SystemExit("the entry day is past the window")
        afternoon = day + 2 * c.fp5.EIGHT_H_MS
        if day not in funding or afternoon not in funding:
            raise SystemExit("a trade is missing a funding print")
        if not (funding[day] < 0.0 < funding[afternoon]):
            raise SystemExit("a trade did not change sign")
        entry_px = bars[day][1]
        exit_px = bars[trade["exit_ms"]][0]
        if abs(trade["net"] - c.short_net(entry_px, exit_px)) > 1e-12:
            raise SystemExit("a fill is not the overnight short")
        if abs(trade["gross"] - (entry_px / exit_px - 1.0)) > 1e-12:
            raise SystemExit("the gross is not the overnight short")
        if trade["entry_ms"] == end:
            raise SystemExit("the 2024 bar was sold")
    pool = c.pool_nets(bars)
    assert_subset(trades, pool)
    row = c.fp5.summarise(c.IDEA, trades, pool, c.MIN_N, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp206_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp206_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {
            "cm": sha256(DATA / "cm1d/BTCUSD_PERP.json"),
            "funding": sha256(DATA / "funding/BTCUSD_PERP.json"),
        },
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp206/screen_2023.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
