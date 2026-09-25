from __future__ import annotations

"""Pins for the fp173 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(open_px, high, low, close_px):
    return (open_px, high, low, close_px)


def test_inside_the_range_three_days_back() -> None:
    if c.IDEA != "COIL" or c.HORIZON != 3 or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    old = signal - 3 * c.fp5.DAY_MS
    bars = {
        old: _bar(10, 20, 10, 15),
        signal: _bar(14, 19, 11, 16),
        entry: _bar(100, 110, 90, 102),
    }
    trades = c.signal_trades(bars)
    if len(trades) != 1 or trades[0]["exit_ms"] != entry:
        raise SystemExit("the next session did not fill")
    fee = Decimal("0.001")
    want = (Decimal(102) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the session fill moved")
    tied = dict(bars)
    tied[signal] = _bar(14, 20, 11, 16)
    if c.signal_trades(tied):
        raise SystemExit("a high equal to the old high fired")
    hole = dict(bars)
    del hole[old]
    if c.signal_trades(hole):
        raise SystemExit("a missing day was filled in")


def main() -> None:
    test_inside_the_range_three_days_back()
    print("fp173 pins ok")


if __name__ == "__main__":
    main()
