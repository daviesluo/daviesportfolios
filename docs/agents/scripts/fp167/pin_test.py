from __future__ import annotations

"""Pins for the fp167 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(open_px: float, high: float, low: float, close_px: float) -> tuple:
    return (open_px, high, low, close_px)


def test_widest_of_four_then_the_session() -> None:
    if c.IDEA != "WIDE4":
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {
        signal - 3 * c.fp5.DAY_MS: _bar(10, 11, 10, 10),
        signal - 2 * c.fp5.DAY_MS: _bar(10, 12, 10, 11),
        signal - c.fp5.DAY_MS: _bar(10, 13, 10, 12),
        signal: _bar(10, 20, 10, 15),
        entry: _bar(100, 110, 90, 103),
    }
    trades = c.signal_trades(bars)
    if len(trades) != 1 or trades[0]["exit_ms"] != entry:
        raise SystemExit("the exit was not that day's close")
    fee = Decimal("0.001")
    want = (Decimal(103) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the session fill moved")
    tied = dict(bars)
    tied[signal] = _bar(10, 13, 10, 12)
    if c.signal_trades(tied):
        raise SystemExit("a range equal to a recent day fired")
    hole = dict(bars)
    del hole[signal - 2 * c.fp5.DAY_MS]
    if c.signal_trades(hole):
        raise SystemExit("a missing day in the four was filled in")


def main() -> None:
    test_widest_of_four_then_the_session()
    print("fp167 pins ok")


if __name__ == "__main__":
    main()
