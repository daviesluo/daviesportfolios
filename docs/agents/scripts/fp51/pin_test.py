"""Pins for the fp51 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def day_hours(day: int, lows: list[float]) -> dict[int, tuple]:
    return {day + i * c.HOUR_MS: (lows[i],) for i in range(24)}


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    daily = {day: (100.0,)}
    if not near(c.above_at(daily, day_hours(day, [101.0] * 24), day), 24.0):
        raise SystemExit("lows above the open were not 24")
    tied = [100.0] * 24
    if not near(c.above_at(daily, day_hours(day, tied), day), 0.0):
        raise SystemExit("a low equal to the open counted")
    mixed = [99.0] * 23 + [101.0]
    if not near(c.above_at(daily, day_hours(day, mixed), day), 1.0):
        raise SystemExit("one hour above the open was not 1")
    missing = day_hours(day, mixed)
    del missing[day + 4 * c.HOUR_MS]
    if c.above_at(daily, missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    if c.above_at({}, day_hours(day, mixed), day) is not None:
        raise SystemExit("a missing open was a print")
    later = c.fp5.SCREEN_END_MS
    later_daily = {later: (100.0,)}
    if c.above_at(later_daily, day_hours(later, [101.0] * 24), later) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(
        c.above_at(later_daily, day_hours(later, [101.0] * 24), later, later + c.fp5.DAY_MS),
        24.0,
    ):
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 1.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 20.0)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = {}
    daily = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        daily[day] = (100.0,)
        lows = [101.0] * 24 if i == 120 else [99.0] * 24
        hours.update(day_hours(day, lows))
    last = start + 120 * c.fp5.DAY_MS
    if c.above_signal_days(daily, hours) != [last]:
        raise SystemExit("a day above its open did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily[entry] = (100.0,)
    daily[exit_] = (101.0,)
    filled = [t for t in c.above_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp51 pins ok")


if __name__ == "__main__":
    main()
