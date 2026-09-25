from __future__ import annotations

"""Pins for the fp180 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(open_px, high, low, close_px):
    return (open_px, high, low, close_px)


def test_close_above_the_prior_open() -> None:
    if c.IDEA != "REVCLOSE" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {
        signal - c.fp5.DAY_MS: _bar(20, 22, 9, 10),
        signal: _bar(12, 24, 11, 21),
        entry: _bar(100, 110, 90, 102),
    }
    trades = c.signal_trades(bars)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the next session did not fill")
    fee = Decimal("0.001")
    want = (Decimal(102) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the session fill moved")
    tied = dict(bars)
    tied[signal] = _bar(12, 24, 11, 20)
    if c.signal_trades(tied):
        raise SystemExit("a close equal to the prior open fired")


def main() -> None:
    test_close_above_the_prior_open()
    print("fp180 pins ok")


if __name__ == "__main__":
    main()
