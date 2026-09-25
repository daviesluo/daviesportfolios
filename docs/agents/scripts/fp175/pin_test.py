from __future__ import annotations

"""Pins for the fp175 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(open_px, high, low, close_px):
    return (open_px, high, low, close_px)


def test_two_higher_highs_then_a_short() -> None:
    if c.IDEA != "HHSH" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    bars = {
        signal - 2 * c.fp5.DAY_MS: _bar(8, 10, 7, 9),
        signal - c.fp5.DAY_MS: _bar(9, 11, 8, 10),
        signal: _bar(10, 12, 9, 11),
        entry: _bar(50, 55, 45, 52),
        later: _bar(49, 51, 47, 48),
    }
    trades = c.signal_trades(bars)
    if len(trades) != 1 or trades[0]["exit_ms"] != later:
        raise SystemExit("the one-day short did not fill")
    fee = Decimal("0.001")
    sold = Decimal(50) * (1 - fee)
    bought = Decimal(49) * (1 + fee)
    want = sold / bought - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the short fill moved")
    if trades[0]["gross"] < 0:
        raise SystemExit("a falling price was scored as a long")
    tied = dict(bars)
    tied[signal - c.fp5.DAY_MS] = _bar(9, 12, 8, 10)
    if c.signal_trades(tied):
        raise SystemExit("a high that did not rise twice fired")


def main() -> None:
    test_two_higher_highs_then_a_short()
    print("fp175 pins ok")


if __name__ == "__main__":
    main()
