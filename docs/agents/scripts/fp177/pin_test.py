from __future__ import annotations

"""Pins for the fp177 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(open_px, high, low, close_px):
    return (open_px, high, low, close_px)


def test_bullish_engulf() -> None:
    if c.IDEA != "ENGULF" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {
        signal - c.fp5.DAY_MS: _bar(20, 22, 9, 10),
        signal: _bar(9, 24, 8, 21),
        entry: _bar(100, 110, 90, 102),
    }
    trades = c.signal_trades(bars)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the next session did not fill")
    fee = Decimal("0.001")
    want = (Decimal(102) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the session fill moved")
    short_body = dict(bars)
    short_body[signal] = _bar(9, 24, 8, 19)
    if c.signal_trades(short_body):
        raise SystemExit("a close under the prior open fired")
    green = dict(bars)
    green[signal - c.fp5.DAY_MS] = _bar(10, 22, 9, 20)
    if c.signal_trades(green):
        raise SystemExit("an up day was engulfed")


def main() -> None:
    test_bullish_engulf()
    print("fp177 pins ok")


if __name__ == "__main__":
    main()
