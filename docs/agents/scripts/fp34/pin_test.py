"""Pins for the fp34 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    nxt = start + c.fp5.DAY_MS
    daily = {start: (50.0, 100.0), nxt: (50.0, 130.0)}
    if c.change_at(daily, nxt) != 30:
        raise SystemExit("a rise of 30 was not 30")
    daily[nxt] = (50.0, 100.0)
    if c.change_at(daily, nxt) != 0:
        raise SystemExit("an unchanged count was not 0")
    rich = {start: (50.0, 1_000_000.0), nxt: (50.0, 1_000_000.0)}
    if c.change_at(rich, nxt) != 0:
        raise SystemExit("the level of the count was the signal")
    if c.change_at({nxt: (50.0, 10.0)}, nxt) is not None:
        raise SystemExit("a missing yesterday was a print")
    later_day = c.fp5.SCREEN_END_MS
    later = {later_day - c.fp5.DAY_MS: (50.0, 10.0), later_day: (50.0, 40.0)}
    if c.change_at(later, later_day) is not None:
        raise SystemExit("a 2024 day was a print")
    if c.change_at(later, later_day, later_day + c.fp5.DAY_MS) != 30:
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 1.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 2.0)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a rise above its own 90th did not fire")
    points[-1] = (points[-1][0], -5.0)
    if c._upper(points, 0.90):
        raise SystemExit("a falling count was returned")
    buried = [(i * c.fp5.DAY_MS, -1.0) for i in range(91)]
    buried[-1] = (buried[-1][0], -0.5)
    if c._upper(buried, 0.90):
        raise SystemExit("a smaller decline fired")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    daily = {}
    for i in range(121):
        daily[start + i * c.fp5.DAY_MS] = (50.0, 100.0 + i)
    last = start + 120 * c.fp5.DAY_MS
    daily[last] = (50.0, daily[last - c.fp5.DAY_MS][1] + 50.0)
    if c.change_signal_days(daily) != [last]:
        raise SystemExit("a jump in the trade count did not fire on its own")
    daily[last] = (50.0, daily[last - c.fp5.DAY_MS][1] - 10.0)
    if c.change_signal_days(daily):
        raise SystemExit("a falling count was scored")
    daily[last] = (50.0, daily[last - c.fp5.DAY_MS][1] + 50.0)
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily[entry] = (100.0, 100.0)
    daily[exit_] = (101.0, 100.0)
    filled = [t for t in c.change_trades(daily) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit("entry must be the next daily open")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail_and_fill()
    print("fp34 pins ok")


if __name__ == "__main__":
    main()
