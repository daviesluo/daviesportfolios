from __future__ import annotations

"""Pins for the fp179 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(open_px, high, low, close_px):
    return (open_px, high, low, close_px)


def test_close_between_prior_close_and_high() -> None:
    if c.IDEA != "LIFT" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {
        signal - c.fp5.DAY_MS: _bar(80, 100, 70, 90),
        signal: _bar(91, 99, 88, 95),
        entry: _bar(50, 60, 40, 51),
    }
    trades = c.signal_trades(bars)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the next session did not fill")
    if trades[0]["gross"] == (51 / 100) - 1:
        raise SystemExit("the buy was yesterday's high")
    fee = Decimal("0.001")
    want = (Decimal(51) * (1 - fee)) / (Decimal(50) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the session fill moved")
    through = dict(bars)
    through[signal] = _bar(91, 110, 88, 100)
    if c.signal_trades(through):
        raise SystemExit("a close equal to yesterday's high fired")


def main() -> None:
    test_close_between_prior_close_and_high()
    print("fp179 pins ok")


if __name__ == "__main__":
    main()
