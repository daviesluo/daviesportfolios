"""Pins for the fp50 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def day_hours(day: int, highs: list[float]) -> dict[int, tuple]:
    return {day + i * c.HOUR_MS: (highs[i],) for i in range(24)}


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    if not near(c.hour_at(day_hours(day, [5.0] * 24), day), 0.0):
        raise SystemExit("a tie did not keep the earliest hour")
    tied = [1.0] * 24
    tied[5] = 9.0
    tied[20] = 9.0
    if not near(c.hour_at(day_hours(day, tied), day), 5.0):
        raise SystemExit("a later tie replaced the earlier hour")
    late = [1.0] * 24
    late[23] = 9.0
    if not near(c.hour_at(day_hours(day, late), day), 23.0):
        raise SystemExit("the last hour was not 23")
    scaled = [v * 10.0 for v in late]
    if not near(c.hour_at(day_hours(day, scaled), day), 23.0):
        raise SystemExit("the price of the high entered the signal")
    missing = day_hours(day, late)
    del missing[day + 2 * c.HOUR_MS]
    if c.hour_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.hour_at(day_hours(later, late), later) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.hour_at(day_hours(later, late), later, later + c.fp5.DAY_MS), 23.0):
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 10.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 23.0)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        highs = [1.0] * 24
        highs[23 if i == 120 else 1] = 9.0
        hours.update(day_hours(day, highs))
    last = start + 120 * c.fp5.DAY_MS
    if c.hour_signal_days(hours) != [last]:
        raise SystemExit("a late high did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.hour_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp50 pins ok")


if __name__ == "__main__":
    main()
