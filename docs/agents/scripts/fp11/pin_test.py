"""Pins for the fp11 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp11/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(px: float) -> tuple:
    return (px, px, px, px, 1.0)


def _pair(ts: int, bid: float, ask: float) -> list[tuple[int, int, float]]:
    return [(ts, -1, bid), (ts, 1, ask)]


def test_imbalance_formula_and_last_snapshot() -> None:
    start = c.fp5.SCREEN_START_MS
    rows = _pair(start + 60_000, 300.0, 100.0)
    got = c.depth_imbalance(rows)
    if got != [(start + c.fp5.EIGHT_H_MS, 0.5)]:
        raise SystemExit(f"imbalance: {got}")
    # An earlier thicker bid loses to the later print.
    rows = _pair(start + 60_000, 900.0, 100.0) + _pair(start + 120_000, 100.0, 100.0)
    got = c.depth_imbalance(rows)
    if got != [(start + c.fp5.EIGHT_H_MS, 0.0)]:
        raise SystemExit(f"last snapshot: {got}")
    # A boundary print belongs to the window that starts there.
    boundary = start + c.fp5.EIGHT_H_MS
    got = c.depth_imbalance(_pair(boundary, 300.0, 100.0))
    if got != [(boundary + c.fp5.EIGHT_H_MS, 0.5)]:
        raise SystemExit(f"boundary window: {got}")
    # The 5% level is not a side.
    far = [(start + 60_000, -5, 300.0), (start + 60_000, 5, 100.0)]
    if c.depth_imbalance(far):
        raise SystemExit("the 5% level was scored")
    if c.depth_imbalance([(start + 60_000, -1, 300.0)]):
        raise SystemExit("a one-sided book was scored")
    if c.depth_imbalance([(start + 60_000, -1, 0.0), (start + 60_000, 1, 100.0)]):
        raise SystemExit("a non-positive notional was scored")


def test_tail_timing_and_window() -> None:
    entry = c.fp5.SCREEN_START_MS + 5 * c.fp5.DAY_MS
    n = 91
    start = entry - n * c.fp5.EIGHT_H_MS
    rows: list[tuple[int, int, float]] = []
    for i in range(n):
        ts = start + i * c.fp5.EIGHT_H_MS + 60_000
        bid, ask = (100.0, 100.0)
        if i == n - 1:
            bid = 300.0
        rows.extend(_pair(ts, bid, ask))
    if entry not in c.depth_entries(rows):
        raise SystemExit("a bid-heavy book must fire")
    btc = {entry: _bar(100.0), entry + c.fp5.EIGHT_H_MS: _bar(101.0)}
    trades = c.depth_trades(rows, btc)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry or trades[0]["coin"] != "BTCUSDT":
        raise SystemExit("entry must be the window end, on spot BTC")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] != c.fp5.EIGHT_H_MS:
        raise SystemExit("the hold is not one 8h bar")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(trades[0]["net"] - float(sold / bought - 1)) > 1e-9:
        raise SystemExit("the fill is not fp5's")
    flat = []
    for i in range(n):
        flat.extend(_pair(start + i * c.fp5.EIGHT_H_MS + 60_000, 100.0, 100.0))
    if c.depth_entries(flat):
        raise SystemExit("an even book must not fire")
    heavy_ask = []
    for i in range(n):
        bid, ask = (100.0, 100.0)
        if i == n - 1:
            ask = 300.0
        heavy_ask.extend(_pair(start + i * c.fp5.EIGHT_H_MS + 60_000, bid, ask))
    if entry in c.depth_entries(heavy_ask):
        raise SystemExit("the ask-heavy tail was scored")
    ancient = []
    old = start - 200 * c.fp5.DAY_MS
    for i in range(91):
        bid = 300.0 if i == 90 else 100.0
        ancient.extend(_pair(old + i * c.fp5.EIGHT_H_MS + 60_000, bid, 100.0))
    recent = []
    for i in range(10):
        bid = 300.0 if i == 9 else 100.0
        recent.extend(_pair(start + i * c.fp5.EIGHT_H_MS + 60_000, bid, 100.0))
    spike = start + 10 * c.fp5.EIGHT_H_MS
    if spike in c.depth_entries(ancient + recent):
        raise SystemExit("prints older than 90 days were counted")


def test_refuses_2024() -> None:
    end = c.fp5.SCREEN_END_MS
    start = end - 91 * c.fp5.EIGHT_H_MS
    rows: list[tuple[int, int, float]] = []
    for i in range(91):
        ts = start + i * c.fp5.EIGHT_H_MS + 60_000
        bid = 300.0 if i == 90 else 100.0
        rows.extend(_pair(ts, bid, 100.0))
    if end not in c.depth_entries(rows):
        raise SystemExit("the boundary print should be an entry candidate")
    btc = {end: _bar(100.0), end + c.fp5.EIGHT_H_MS: _bar(101.0)}
    if c.depth_trades(rows, btc):
        raise SystemExit("an entry at 2024-01-01 was kept")
    later = _pair(end + 60_000, 900.0, 100.0)
    if c.depth_imbalance(later):
        raise SystemExit("a 2024 snapshot was read")


def main() -> None:
    test_imbalance_formula_and_last_snapshot()
    test_tail_timing_and_window()
    test_refuses_2024()
    print("fp11 pins ok")


if __name__ == "__main__":
    main()
