"""Pins for the fp46 rule. No file and no return from 2023 is read."""

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
    closes = [100.0] * 23 + [200.0]
    want = 200.0 / ((23 * 100.0 + 200.0) / 24.0) - 1.0
    if not near(c.mean_at(day_hours(day, closes), day), want):
        raise SystemExit("the equal-weighted mean was wrong")
    if not near(c.mean_at(day_hours(day, [100.0] * 24), day), 0.0):
        raise SystemExit("a flat day was not zero")
    missing = day_hours(day, closes)
    del missing[day + 5 * c.HOUR_MS]
    if c.mean_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.mean_at(day_hours(later, closes), later) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.mean_at(day_hours(later, closes), later, later + c.fp5.DAY_MS), want):
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 1.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 2.0)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        close = 200.0 if i == 120 else 100.0
        hours.update(day_hours(day, [100.0] * 23 + [close]))
    last = start + 120 * c.fp5.DAY_MS
    if c.mean_signal_days(hours) != [last]:
        raise SystemExit("a close above the day's mean did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.mean_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp46 pins ok")


if __name__ == "__main__":
    main()
