from __future__ import annotations

"""Pins for the fp159 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _day(day: int, a: float, b: float, d: float) -> list[tuple[int, float]]:
    return [
        (day, a),
        (day + c.fp5.EIGHT_H_MS, b),
        (day + 2 * c.fp5.EIGHT_H_MS, d),
    ]


def test_first_print_strictly_richest() -> None:
    if c.IDEA != "PEAK0":
        raise SystemExit("the idea moved")
    day = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    bars = {entry: (100.0,), later: (101.0,)}
    funding = c.funding_hours(_day(day, 0.0003, 0.0001, 0.0002))
    trades = c.signal_trades(funding, bars)
    if len(trades) != 1 or trades[0]["exit_ms"] - trades[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the richest 00:00 rate did not hold one day")
    fee = Decimal("0.001")
    want = (Decimal(101) * (1 - fee)) / (Decimal(100) * (1 + fee)) - 1
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    tied = c.funding_hours(_day(day, 0.0003, 0.0003, 0.0001))
    if c.signal_trades(tied, bars):
        raise SystemExit("a tie with the 08:00 rate fired")
    later_rich = c.funding_hours(_day(day, 0.0001, 0.0004, 0.0002))
    if c.signal_trades(later_rich, bars):
        raise SystemExit("a richer later print was treated as the open")
    if c.signal_trades(c.funding_hours(_day(c.fp5.SCREEN_END_MS, 0.01, 0.0, 0.0)), bars):
        raise SystemExit("a 2024 funding day was an entry")


def main() -> None:
    test_first_print_strictly_richest()
    print("fp159 pins ok")


if __name__ == "__main__":
    main()
