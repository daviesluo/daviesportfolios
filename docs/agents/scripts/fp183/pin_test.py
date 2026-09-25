from __future__ import annotations

"""Pins for the fp183 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(open_px, high, low, close_px):
    return (open_px, high, low, close_px)


def test_wider_up_body() -> None:
    if c.IDEA != "BODYGT" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {
        signal - c.fp5.DAY_MS: _bar(10, 12, 9, 11),
        signal: _bar(10, 16, 9, 13),
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
    tied[signal] = _bar(10, 16, 9, 11)
    if c.signal_trades(tied):
        raise SystemExit("an equal body fired")
    down = dict(bars)
    down[signal] = _bar(13, 16, 8, 10)
    if c.signal_trades(down):
        raise SystemExit("a down day fired")


def main() -> None:
    test_wider_up_body()
    print("fp183 pins ok")


if __name__ == "__main__":
    main()
