from __future__ import annotations

"""Pins for the fp190 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

def test_split() -> None:
    if c.IDEA != "CMBUY" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {entry: (100.0, 102.0)}
    trades = c.signal_trades(bars, ({signal: (10.0, 4.0)}, {signal: (10.0, 6.0)}))
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the next session did not fill")
    if c.signal_trades(bars, ({signal: (10.0, 6.0)}, {signal: (10.0, 6.0)})):
        raise SystemExit("a USDT majority fired")
    if c.signal_trades(bars, ({signal: (10.0, 4.0)}, {signal: (10.0, 5.0)})):
        raise SystemExit("an equal half fired")
    if c.signal_trades(bars, ({signal: (0.0, 0.0)}, {signal: (10.0, 6.0)})):
        raise SystemExit("a zero volume fired")


def main() -> None:
    test_split()
    print("fp190 pins ok")


if __name__ == "__main__":
    main()
