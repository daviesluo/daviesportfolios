from __future__ import annotations

"""Pins for the fp184 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(open_px, high, low, close_px):
    return (open_px, high, low, close_px)


def test_close_above_the_older_high() -> None:
    if c.IDEA != "DELAY" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {
        signal - 2 * c.fp5.DAY_MS: _bar(8, 10, 7, 9),
        signal - c.fp5.DAY_MS: _bar(12, 20, 11, 18),
        signal: _bar(16, 19, 14, 15),
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
    tied[signal] = _bar(16, 19, 14, 10)
    if c.signal_trades(tied):
        raise SystemExit("a close equal to the older high fired")
    missing = dict(bars)
    del missing[signal - 2 * c.fp5.DAY_MS]
    if c.signal_trades(missing):
        raise SystemExit("a missing day fired")


def main() -> None:
    test_close_above_the_older_high()
    print("fp184 pins ok")


if __name__ == "__main__":
    main()
