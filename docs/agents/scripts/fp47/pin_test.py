"""Pins for the fp47 rule. No file and no return from 2023 is read."""

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
    highs = [5.0, 10.0, 8.0, 9.0] + [5.0] * 20
    if not near(c.newhigh_at(day_hours(day, highs), day), 1.0):
        raise SystemExit("a high under an earlier high counted")
    rising = [float(i + 1) for i in range(24)]
    if not near(c.newhigh_at(day_hours(day, rising), day), 23.0):
        raise SystemExit("a rising day was not 23")
    missing = day_hours(day, highs)
    del missing[day + 3 * c.HOUR_MS]
    if c.newhigh_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.newhigh_at(day_hours(later, rising), later) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.newhigh_at(day_hours(later, rising), later, later + c.fp5.DAY_MS), 23.0):
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
        if i == 120:
            highs = [float(h + 1) for h in range(24)]
        else:
            highs = [5.0, 10.0] + [5.0] * 22
        hours.update(day_hours(day, highs))
    last = start + 120 * c.fp5.DAY_MS
    if c.newhigh_signal_days(hours) != [last]:
        raise SystemExit("a day of new highs did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.newhigh_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp47 pins ok")


if __name__ == "__main__":
    main()
