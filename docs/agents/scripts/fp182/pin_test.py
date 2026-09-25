from __future__ import annotations

"""Pins for the fp182 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(open_px, high, low, close_px):
    return (open_px, high, low, close_px)


def test_lower_low_and_higher_close() -> None:
    if c.IDEA != "DIP" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {
        signal - c.fp5.DAY_MS: _bar(11, 14, 10, 12),
        signal: _bar(12, 16, 9, 13),
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
    tied[signal] = _bar(12, 16, 10, 13)
    if c.signal_trades(tied):
        raise SystemExit("an equal low fired")


def main() -> None:
    test_lower_low_and_higher_close()
    print("fp182 pins ok")


if __name__ == "__main__":
    main()
