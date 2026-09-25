"""Pins for the fp54 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9



def day_hours(day: int, quotes: list[float]) -> dict[int, tuple]:
    return {day + i * c.HOUR_MS: (quotes[i],) for i in range(24)}


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    late = [0.0] * 24
    late[23] = 5.0
    if not near(c.clock_at(day_hours(day, late), day), 23.0):
        raise SystemExit("quote in the last hour was not 23")
    early = [0.0] * 24
    early[0] = 5.0
    if not near(c.clock_at(day_hours(day, early), day), 0.0):
        raise SystemExit("quote in the first hour was not 0")
    flat = [1.0] * 24
    if not near(c.clock_at(day_hours(day, flat), day), 11.5):
        raise SystemExit("equal quote was not the middle of the day")
    scaled = [q * 7.0 for q in late]
    if not near(c.clock_at(day_hours(day, scaled), day), 23.0):
        raise SystemExit("scaling quote changed the clock")
    middle = [0.0] * 24
    for i in range(6, 18):
        middle[i] = 1.0
    if not near(c.clock_at(day_hours(day, middle), day), 11.5):
        raise SystemExit("a day with no quote in the first or last six hours dropped out")
    missing = day_hours(day, flat)
    del missing[day + 13 * c.HOUR_MS]
    if c.clock_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.clock_at(day_hours(later, late), later) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.clock_at(day_hours(later, late), later, later + c.fp5.DAY_MS), 23.0):
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
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        quotes = [0.0] * 24
        quotes[0 if i < 120 else 23] = 1.0
        series.update(day_hours(day, quotes))
    last = start + 120 * c.fp5.DAY_MS
    if c.clock_signal_days(series) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.clock_trades(daily, series) if t["entry_ms"] == entry]
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
    print("fp54 pins ok")


if __name__ == "__main__":
    main()
