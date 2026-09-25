from __future__ import annotations

"""Pins for the fp191 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

def test_above_average() -> None:
    if c.IDEA != "ABOVEVW" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {
        signal: (10.0, 12.0, 2.0, 22.0),
        entry: (100.0, 102.0, 1.0, 101.0),
    }
    trades = c.signal_trades(bars, None)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the next session did not fill")
    if abs(trades[0]["gross"] - (12 / 10 - 1)) < 1e-12:
        raise SystemExit("the fill used the signal day")
    equal = dict(bars)
    equal[signal] = (10.0, 11.0, 2.0, 22.0)
    if c.signal_trades(equal, None):
        raise SystemExit("an equal average fired")
    under = dict(bars)
    under[signal] = (10.0, 10.0, 2.0, 22.0)
    if c.signal_trades(under, None):
        raise SystemExit("a close under the average fired")


def main() -> None:
    test_above_average()
    print("fp191 pins ok")


if __name__ == "__main__":
    main()
