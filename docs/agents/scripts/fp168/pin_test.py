from __future__ import annotations

"""Pins for the fp168 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def test_both_rose_and_the_hold_is_two_days() -> None:
    if c.IDEA != "FLOW" or c.HOLD_DAYS != 2:
        raise SystemExit("the hold moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    mid = entry + c.fp5.DAY_MS
    exit_ms = entry + 2 * c.fp5.DAY_MS
    bars = {entry: (100.0,), mid: (50.0,), exit_ms: (102.0,)}
    trades = c.signal_trades({signal: (4.0, 5.0)}, {signal: (0.8, 1.1)}, bars)
    if len(trades) != 1 or trades[0]["exit_ms"] != exit_ms:
        raise SystemExit("the hold is not two days")
    fee = Decimal("0.001")
    want = (Decimal(102) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the two-day fill moved")
    if abs(trades[0]["net"] - c.fp5.net_return(100.0, 50.0)) < 1e-9:
        raise SystemExit("a one-day hold replaced the two-day hold")
    if c.signal_trades({signal: (5.0, 5.0)}, {signal: (0.8, 1.1)}, bars):
        raise SystemExit("flat open interest fired")
    if c.signal_trades({signal: (4.0, 5.0)}, {signal: (1.1, 0.8)}, bars):
        raise SystemExit("a falling taker ratio fired")
    if c.signal_trades({signal: (0.0, 5.0)}, {signal: (0.8, 1.1)}, bars):
        raise SystemExit("a non-positive first open-interest print fired")


def main() -> None:
    test_both_rose_and_the_hold_is_two_days()
    print("fp168 pins ok")


if __name__ == "__main__":
    main()
