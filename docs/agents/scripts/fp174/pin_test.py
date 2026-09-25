from __future__ import annotations

"""Pins for the fp174 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(open_px, high, low, close_px):
    return (open_px, high, low, close_px)


def test_wider_than_six_days_ago() -> None:
    if c.IDEA != "LAG6" or c.HORIZON != 6 or c.HOLD_DAYS != 2 or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    exit_ms = entry + 2 * c.fp5.DAY_MS
    bars = {
        signal - 6 * c.fp5.DAY_MS: _bar(10, 11, 10, 10),
        signal: _bar(10, 15, 10, 12),
        entry: _bar(100, 101, 99, 100),
        exit_ms: _bar(103, 104, 102, 103),
    }
    trades = c.signal_trades(bars)
    if len(trades) != 1 or trades[0]["exit_ms"] != exit_ms:
        raise SystemExit("the two-day hold moved")
    fee = Decimal("0.001")
    want = (Decimal(103) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the fill moved")
    one_day = (Decimal(50) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(one_day)) < 1e-12:
        raise SystemExit("the hold collapsed to one day")
    tied = dict(bars)
    tied[signal] = _bar(10, 11, 10, 10)
    if c.signal_trades(tied):
        raise SystemExit("an equal range fired")


def main() -> None:
    test_wider_than_six_days_ago()
    print("fp174 pins ok")


if __name__ == "__main__":
    main()
