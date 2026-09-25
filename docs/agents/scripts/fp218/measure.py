"""Score the fp218 screen. 2023 entries only.

    python3 docs/agents/scripts/fp218/measure.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("FP218_DATA", "/tmp/fp218/data"))
PROTOCOL = ROOT / "docs/agents/reviews/2026-09-25-fp218-matched-protocol.md"
NOTE = "A UTC day numbered 1 through 7 is bought and sold at the next month's first open. One USDT-perpetual leg. Funding cash is not added. The null draws, within each hold length the rule used, that many opens held exactly that many days."
FIELDS = {"coin", "entry_ms", "exit_ms", "gross", "net", "pnl"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_rows(path: Path) -> dict[int, tuple]:
    rows = json.loads(path.read_text())
    out = {}
    for row in rows:
        if len(row) != 2:
            raise SystemExit(f"{path.name} carries a field this rule does not use")
        ts = int(row[0])
        if ts > c.fp5.SCREEN_END_MS:
            raise SystemExit(f"{path.name} goes past the window")
        out[ts] = (float(row[1]),)
    if not out or max(out) != c.fp5.SCREEN_END_MS:
        raise SystemExit(path.name + " stops on the wrong day")
    return out


def check_common(trade: dict) -> None:
    if set(trade) != FIELDS:
        raise SystemExit("a fill carries a field this rule does not use")
    if trade["coin"] != "BTCUSDT":
        raise SystemExit("a fill is not BTC")
    if not (c.fp5.SCREEN_START_MS <= trade["entry_ms"] < c.fp5.SCREEN_END_MS):
        raise SystemExit("a 2024 open was read as an entry")
    if trade["exit_ms"] - trade["entry_ms"] <= c.fp5.DAY_MS:
        raise SystemExit("the hold is one day or overnight")
    if abs(trade["pnl"] - 100.0 * trade["net"]) > 1e-9:
        raise SystemExit("the dollar result is not a hundred dollars times the net")


def assert_matched(trades, spans, pool_spans, by_hold) -> None:
    if not trades:
        raise SystemExit("the rule has no fill")
    if hasattr(c, "POOL_MIN"):
        raise SystemExit("the seven-day floor is still the null")
    need = {}
    for trade, (entry, exit_ms) in zip(trades, spans):
        hold = (exit_ms - entry) // c.fp5.DAY_MS
        if (trade["exit_ms"] - trade["entry_ms"]) // c.fp5.DAY_MS != hold:
            raise SystemExit("the fill and the span diverged")
        need[hold] = need.get(hold, 0) + 1
    if set(spans) - set(pool_spans):
        raise SystemExit("a fill is not in the null pool")
    ordered = sorted(pool_spans, key=lambda pair: ((pair[1] - pair[0]) // c.fp5.DAY_MS, pair[0]))
    if list(pool_spans) != ordered:
        raise SystemExit("the pool order moved")
    seen = set()
    previous = (-1, -1)
    for entry, exit_ms in pool_spans:
        hold = (exit_ms - entry) // c.fp5.DAY_MS
        if hold not in need or hold < 22 or hold > 31:
            raise SystemExit("the null holds a length the rule does not")
        if exit_ms != entry + hold * c.fp5.DAY_MS:
            raise SystemExit("the null exit is not that many days later")
        if exit_ms - entry <= c.fp5.DAY_MS:
            raise SystemExit("the null hold is one day or overnight")
        if (hold, entry) <= previous:
            raise SystemExit("the pool order moved")
        previous = (hold, entry)
        seen.add(hold)
    if seen != set(need):
        raise SystemExit("a strategy length has no pool")
    for hold, count in need.items():
        if len(by_hold[hold]) <= count:
            raise SystemExit("a length pool is not larger than the rule")
    counts = {hold: Counter(nets) for hold, nets in by_hold.items()}
    for trade in trades:
        hold = (trade["exit_ms"] - trade["entry_ms"]) // c.fp5.DAY_MS
        if counts[hold][trade["net"]] <= 0:
            raise SystemExit("a fill is not in its length pool")
        counts[hold][trade["net"]] -= 1


def run() -> None:
    um = load_rows(DATA / "um1d/BTCUSDT.json")
    trades = c.signal_trades(um)
    spans = c.signal_spans(um)
    if [t["entry_ms"] for t in trades] != [entry for entry, _exit in spans]:
        raise SystemExit("the fills and the spans diverged")
    for trade in trades:
        check_common(trade)
        stamp = datetime.fromtimestamp(trade["entry_ms"] / 1000, timezone.utc)
        if stamp.day > 7:
            raise SystemExit("the entry is not in the first week")
        if trade["exit_ms"] != c._next_month(trade["entry_ms"]):
            raise SystemExit("the exit is not the next month")
        hold = (trade["exit_ms"] - trade["entry_ms"]) // c.fp5.DAY_MS
        if hold < 22 or hold > 31:
            raise SystemExit("the month hold moved")
        entry_px = um[trade["entry_ms"]][0]
        exit_px = um[trade["exit_ms"]][0]
        if abs(trade["gross"] - (exit_px / entry_px - 1.0)) > 1e-12:
            raise SystemExit("the gross is not the one leg")
        if abs(trade["net"] - c.fp5.net_return(entry_px, exit_px)) > 1e-12:
            raise SystemExit("the net is not the one leg")
    pool_spans = c.pool_spans(um)
    by_hold = c.pool_by_hold(um)
    if c.IDEA != "MTH" or c.MIN_N != 30:
        raise SystemExit("the frozen name or the count moved")
    assert_matched(trades, spans, pool_spans, by_hold)
    row = c.screen_row(trades, by_hold, NOTE)
    payload = {
        "protocol_sha256": sha256(PROTOCOL),
        "code_sha256": {
            "fp218_common": sha256(Path(__file__).resolve().parent / "common.py"),
            "fp218_measure": sha256(Path(__file__)),
            "fp5_common": sha256(Path(__file__).resolve().parents[1] / "fp5" / "common.py"),
        },
        "input_sha256": {"um": sha256(DATA / "um1d/BTCUSDT.json")},
        "ideas": [row],
        "passed": [row["idea"]] if row["passes_screen"] else [],
    }
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out = ROOT / "docs/agents/backtests/fp218/screen_2023_matched.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(text, end="")


def main() -> None:
    if os.environ.get("FP218_OOS"):
        raise SystemExit("this scorer is the 2023 screen")
    if not PROTOCOL.is_file():
        raise SystemExit("the protocol file is not on disk; do not score without it")
    run()


if __name__ == "__main__":
    main()
