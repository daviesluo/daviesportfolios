from __future__ import annotations

"""Pins for the fp192 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

def test_under_mark() -> None:
    if c.IDEA != "UNDMARK" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {entry: (100.0, 102.0)}
    trades = c.signal_trades(bars, ({signal: (2.0, 20.0)}, {signal: (11.0,)}))
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the next session did not fill")
    if abs(trades[0]["gross"] - (11 / 10 - 1)) < 1e-9:
        raise SystemExit("the gross used the mark")
    if c.signal_trades(bars, ({signal: (2.0, 22.0)}, {signal: (11.0,)})):
        raise SystemExit("an equal mark fired")
    if c.signal_trades(bars, ({signal: (2.0, 24.0)}, {signal: (11.0,)})):
        raise SystemExit("an average above the mark fired")
    if c.signal_trades(bars, ({signal: (2.0, 20.0)}, {})):
        raise SystemExit("a missing mark fired")


def main() -> None:
    test_under_mark()
    print("fp192 pins ok")


if __name__ == "__main__":
    main()
