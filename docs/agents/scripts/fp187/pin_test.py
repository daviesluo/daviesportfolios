from __future__ import annotations

"""Pins for the fp187 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

def test_under_index() -> None:
    if c.IDEA != "SPOTIDX" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {signal: (8.0, 9.0), entry: (100.0, 102.0)}
    index = {signal: (10.0,)}
    trades = c.signal_trades(bars, index)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the next session did not fill")
    if abs(trades[0]["gross"] - (102 / 100 - 1)) > 1e-12:
        raise SystemExit("the gross used the index")
    equal = {signal: (9.0,)}
    if c.signal_trades(bars, equal):
        raise SystemExit("an equal index fired")
    rich = {signal: (8.0,)}
    if c.signal_trades(bars, rich):
        raise SystemExit("spot above the index fired")


def main() -> None:
    test_under_index()
    print("fp187 pins ok")


if __name__ == "__main__":
    main()
