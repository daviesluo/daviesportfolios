from __future__ import annotations

"""Pins for the fp176 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(open_px, high, low, close_px):
    return (open_px, high, low, close_px)


def test_close_above_the_prior_three() -> None:
    if c.IDEA != "C3" or c.HOLD_DAYS != 3 or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    exit_ms = entry + 3 * c.fp5.DAY_MS
    bars = {
        signal - 3 * c.fp5.DAY_MS: _bar(1, 2, 1, 10),
        signal - 2 * c.fp5.DAY_MS: _bar(1, 2, 1, 11),
        signal - c.fp5.DAY_MS: _bar(1, 2, 1, 12),
        signal: _bar(1, 2, 1, 13),
        entry: _bar(100, 101, 99, 100),
        exit_ms: _bar(104, 105, 103, 104),
    }
    trades = c.signal_trades(bars)
    if len(trades) != 1 or trades[0]["exit_ms"] != exit_ms:
        raise SystemExit("the three-day hold moved")
    fee = Decimal("0.001")
    want = (Decimal(104) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the fill moved")
    tied = dict(bars)
    tied[signal] = _bar(1, 2, 1, 12)
    if c.signal_trades(tied):
        raise SystemExit("a close equal to a prior close fired")
    hole = dict(bars)
    del hole[signal - 2 * c.fp5.DAY_MS]
    if c.signal_trades(hole):
        raise SystemExit("a missing close was filled in")


def main() -> None:
    test_close_above_the_prior_three()
    print("fp176 pins ok")


if __name__ == "__main__":
    main()
