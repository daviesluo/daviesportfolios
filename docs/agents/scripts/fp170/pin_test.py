from __future__ import annotations

"""Pins for the fp170 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _day(day, a, b, d):
    return [(day, a), (day + c.fp5.EIGHT_H_MS, b), (day + 2 * c.fp5.EIGHT_H_MS, d)]


def test_the_middle_print_is_the_lowest() -> None:
    if c.IDEA != "FNTROUGH" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    day = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    bars = {entry: (100.0,), later: (101.0,)}
    funding = c.funding_hours(_day(day, 0.0003, 0.0001, 0.0002))
    trades = c.signal_trades(funding, bars)
    if len(trades) != 1 or trades[0]["exit_ms"] - trades[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the one-day long did not fill")
    fee = Decimal("0.001")
    want = (Decimal(101) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the fill moved")
    rising = c.funding_hours(_day(day, 0.0001, 0.0002, 0.0003))
    if c.signal_trades(rising, bars):
        raise SystemExit("a rising path fired")
    tied = c.funding_hours(_day(day, 0.0001, 0.0001, 0.0002))
    if c.signal_trades(tied, bars):
        raise SystemExit("a tie at the low fired")


def main() -> None:
    test_the_middle_print_is_the_lowest()
    print("fp170 pins ok")


if __name__ == "__main__":
    main()
