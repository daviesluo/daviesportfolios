from __future__ import annotations

"""Pins for the fp154 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _hours(day: int, a: float, b: float, d: float) -> list[tuple[int, float]]:
    return [
        (day, a),
        (day + c.fp5.EIGHT_H_MS, b),
        (day + 2 * c.fp5.EIGHT_H_MS, d),
    ]


def test_short_keeps_the_hold_funding() -> None:
    if c.IDEA != "FNCARRY":
        raise SystemExit("the idea moved")
    fee = Decimal("0.001")
    price = (Decimal(100) * (1 - fee)) / (Decimal(99) * (1 + fee)) - 1
    want = price + Decimal("0.0003") + Decimal("-0.0001")
    decision = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    events = _hours(decision, 0.0002, 0.0002, 0.0002) + _hours(entry, 0.0001, 0.0003, -0.0001)
    funding = c.funding_hours(events)
    um = {entry: (100.0,), later: (99.0,)}
    trades = c.signal_trades(funding, um)
    if len(trades) != 1:
        raise SystemExit("a positive funding sum did not short the next day")
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the short fill dropped the hold's funding")
    if abs(trades[0]["net"] - c.fp5.net_return(100.0, 99.0)) < 1e-9:
        raise SystemExit("the short collapsed to a long")
    # The decision sum is not added on top of the hold's rates.
    decision_sum = 0.0006
    if abs(trades[0]["net"] - float(want) - decision_sum) < 1e-6:
        raise SystemExit("the decision day's funding was paid twice")


def test_flat_sum_and_the_hold_day() -> None:
    decision = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    um = {entry: (100.0,), later: (100.0,)}
    flat = c.funding_hours(_hours(decision, 0.0001, 0.0, -0.0001) + _hours(entry, 0.01, 0.01, 0.01))
    if c.signal_trades(flat, um):
        raise SystemExit("a zero sum fired")
    negative = c.funding_hours(_hours(decision, -0.0001, -0.0001, -0.0001) + _hours(entry, 0.01, 0.01, 0.01))
    if c.signal_trades(negative, um):
        raise SystemExit("a negative sum was shorted because the hold day paid")
    if c.signal_trades(c.funding_hours(_hours(c.fp5.SCREEN_END_MS, 0.01, 0.01, 0.01)), um):
        raise SystemExit("a 2024 funding day was an entry")


def main() -> None:
    test_short_keeps_the_hold_funding()
    test_flat_sum_and_the_hold_day()
    print("fp154 pins ok")


if __name__ == "__main__":
    main()
