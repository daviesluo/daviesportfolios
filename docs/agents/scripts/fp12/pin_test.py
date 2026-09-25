"""Pins for the fp12 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp12/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(close: float) -> tuple:
    return (close, close, close, close, 1.0)


def _series(start: int, closes: list[float]) -> dict[int, tuple]:
    return {start + i * c.fp5.EIGHT_H_MS: _bar(close) for i, close in enumerate(closes)}


def test_rich_bar_holds_spot_btc() -> None:
    entry = c.fp5.SCREEN_START_MS + 5 * c.fp5.DAY_MS
    wide_at = 96
    start = entry - (wide_at + 1) * c.fp5.EIGHT_H_MS
    closes = [100.0] * (wide_at + 3)
    closes[wide_at] = 120.0
    bars = _series(start, closes)
    if entry not in c.dom_entries(bars):
        raise SystemExit("a rich dominance bar must fire")
    btc = {
        entry: _bar(100.0),
        entry + c.fp5.EIGHT_H_MS: _bar(101.0),
    }
    trades = c.dom_trades(bars, btc)
    if len(trades) != 1 or trades[0]["coin"] != "BTCUSDT" or trades[0]["entry_ms"] != entry:
        raise SystemExit("the position is spot BTC at the print time")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(trades[0]["net"] - float(sold / bought - 1)) > 1e-9:
        raise SystemExit("the fill is not fp5's")
    down = [100.0] * (wide_at + 3)
    down[wide_at] = 80.0
    if entry in c.dom_entries(_series(start, down)):
        raise SystemExit("the low tail was scored")


def test_equal_hole_and_window() -> None:
    entry = c.fp5.SCREEN_START_MS + 5 * c.fp5.DAY_MS
    wide_at = 96
    start = entry - (wide_at + 1) * c.fp5.EIGHT_H_MS
    level = [2.0 ** i for i in range(wide_at + 3)]
    if c.dom_entries(_series(start, level)):
        raise SystemExit("a return equal to the trailing 90th must not fire")
    closes = [100.0] * (wide_at + 3)
    closes[wide_at] = 120.0
    bars = _series(start, closes)
    del bars[start + (wide_at - 1) * c.fp5.EIGHT_H_MS]
    if entry in c.dom_entries(bars):
        raise SystemExit("a missing previous bar was filled in")
    ancient = _series(start - 200 * c.fp5.DAY_MS, [100.0] * 10)
    ancient[start - 200 * c.fp5.DAY_MS + 9 * c.fp5.EIGHT_H_MS] = _bar(150.0)
    recent = _series(start, [100.0] * 10)
    recent[start + 9 * c.fp5.EIGHT_H_MS] = _bar(150.0)
    spike = start + 10 * c.fp5.EIGHT_H_MS
    if spike in c.dom_entries({**ancient, **recent}):
        raise SystemExit("prints older than 90 days were counted")


def test_refuses_2024() -> None:
    t = c.fp5.SCREEN_END_MS - c.fp5.EIGHT_H_MS
    n_bars = 97
    start = t - (n_bars - 1) * c.fp5.EIGHT_H_MS
    closes = [100.0] * n_bars
    closes[-1] = 130.0
    bars = _series(start, closes)
    if c.fp5.SCREEN_END_MS not in c.dom_entries(bars):
        raise SystemExit("the boundary print should be an entry candidate")
    btc = {c.fp5.SCREEN_END_MS: _bar(100.0), c.fp5.SCREEN_END_MS + c.fp5.EIGHT_H_MS: _bar(101.0)}
    if c.dom_trades(bars, btc):
        raise SystemExit("an entry at 2024-01-01 was kept")
    bars[c.fp5.SCREEN_END_MS] = _bar(200.0)
    if c.fp5.SCREEN_END_MS + c.fp5.EIGHT_H_MS in c.dom_entries(bars):
        raise SystemExit("a 2024 bar was read")


def main() -> None:
    test_rich_bar_holds_spot_btc()
    test_equal_hole_and_window()
    test_refuses_2024()
    print("fp12 pins ok")


if __name__ == "__main__":
    main()
