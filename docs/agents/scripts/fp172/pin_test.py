from __future__ import annotations

"""Pins for the fp172 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(open_px, high, low, close_px):
    return (open_px, high, low, close_px)


def _want(entry, exit_px):
    fee = Decimal("0.001")
    return float((Decimal(str(exit_px)) * (1 - fee)) / (Decimal(str(entry)) * (1 + fee)) - 1)


def test_stop_at_the_prior_low() -> None:
    if c.IDEA != "STOPLOW" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    down = _bar(10, 11, 8, 9)
    held = {
        signal: down,
        entry: _bar(100, 110, 99, 104),
    }
    trades = c.signal_trades(held)
    if len(trades) != 1 or abs(trades[0]["net"] - _want(100, 104)) > 1e-12:
        raise SystemExit("a low that stayed above the stop did not sell the close")
    stopped = {signal: down, entry: _bar(100, 110, 90, 104)}
    # prior low is 8, and 90 is not under 8. Use a prior low of 95.
    stopped = {signal: _bar(10, 11, 95, 9), entry: _bar(100, 110, 90, 104)}
    trades = c.signal_trades(stopped)
    if len(trades) != 1 or abs(trades[0]["net"] - _want(100, 95)) > 1e-12:
        raise SystemExit("the stop was not yesterday's low")
    gapped = {signal: _bar(10, 11, 95, 9), entry: _bar(90, 100, 80, 99)}
    trades = c.signal_trades(gapped)
    if len(trades) != 1 or abs(trades[0]["net"] - _want(90, 90)) > 1e-12:
        raise SystemExit("an open through the stop did not exit at the open")
    up = {signal: _bar(9, 12, 8, 11), entry: _bar(100, 110, 90, 104)}
    if c.signal_trades(up):
        raise SystemExit("an up day fired")


def main() -> None:
    test_stop_at_the_prior_low()
    print("fp172 pins ok")


if __name__ == "__main__":
    main()
