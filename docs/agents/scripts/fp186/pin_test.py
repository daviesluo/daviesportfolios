from __future__ import annotations

"""Pins for the fp186 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c

def test_flip() -> None:
    if c.IDEA != "BKFLIP" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    bars = {entry: (50.0, 49.0)}
    book = {signal: (4.0, 5.0, 6.0, 5.0)}
    trades = c.signal_trades(bars, book)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the next session did not fill")
    if trades[0]["gross"] >= 0:
        raise SystemExit("the gross sign moved")
    already = {signal: (6.0, 5.0, 7.0, 6.0)}
    if c.signal_trades(bars, already):
        raise SystemExit("a book that opened bid-heavy fired")
    stayed = {signal: (4.0, 5.0, 4.0, 5.0)}
    if c.signal_trades(bars, stayed):
        raise SystemExit("a book that stayed ask-heavy fired")
    tied = {signal: (4.0, 4.0, 6.0, 5.0)}
    if c.signal_trades(bars, tied):
        raise SystemExit("an equal open fired")


def main() -> None:
    test_flip()
    print("fp186 pins ok")


if __name__ == "__main__":
    main()
