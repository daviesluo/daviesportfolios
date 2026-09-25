"""Pins for the fp68 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def day_hours(day: int, closes: list[float]) -> dict[int, tuple]:
    return {day + i * c.HOUR_MS: (closes[i],) for i in range(24)}


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    yday = day - c.fp5.DAY_MS
    level = {yday + 23 * c.HOUR_MS: (100.0,)}
    above = [101.0, 103.0, 102.0, 104.0] + [105.0] * 20
    hours = {}
    hours.update(level)
    hours.update(day_hours(day, above))
    if not near(c.cross_at(hours, day), 0.0):
        raise SystemExit("closes that stayed above the level were counted as crosses")
    crossed = [101.0, 99.0, 101.0] + [101.0] * 21
    hours = {}
    hours.update(level)
    hours.update(day_hours(day, crossed))
    if not near(c.cross_at(hours, day), 2.0):
        raise SystemExit("two crosses of yesterday's close were wrong")
    touch = [101.0, 100.0, 99.0] + [99.0] * 21
    hours = {}
    hours.update(level)
    hours.update(day_hours(day, touch))
    if not near(c.cross_at(hours, day), 1.0):
        raise SystemExit("a touch of the level erased the cross")
    missing = dict(hours)
    del missing[day + 13 * c.HOUR_MS]
    if c.cross_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    no_level = day_hours(day, crossed)
    if c.cross_at(no_level, day) is not None:
        raise SystemExit("a missing prior close was a print")
    later = c.fp5.SCREEN_END_MS
    later_hours = {later - c.fp5.DAY_MS + 23 * c.HOUR_MS: (100.0,)}
    later_hours.update(day_hours(later, crossed))
    if c.cross_at(later_hours, later) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.cross_at(later_hours, later, later + c.fp5.DAY_MS), 2.0):
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 2.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 20.0)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    series = {}
    for i in range(122):
        day = start + i * c.fp5.DAY_MS
        series[day + 23 * c.HOUR_MS] = (100.0,)
        if i < 121:
            for h in range(23):
                series[day + h * c.HOUR_MS] = (101.0,)
    last = start + 120 * c.fp5.DAY_MS
    series[last] = (101.0,)
    series[last + c.HOUR_MS] = (99.0,)
    series[last + 2 * c.HOUR_MS] = (101.0,)
    if c.cross_signal_days(series) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.cross_trades(daily, series) if t["entry_ms"] == entry]
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
    print("fp68 pins ok")


if __name__ == "__main__":
    main()
