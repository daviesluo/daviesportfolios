"""Pins for the fp76 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def stacked(day: int) -> dict[int, tuple]:
    """Each hour has range 1 and the day has range 24. Bar is (high, low)."""
    out = {}
    for i in range(24):
        out[day + i * c.HOUR_MS] = (float(i + 2), float(i + 1))
    return out


def overlap(day: int) -> dict[int, tuple]:
    """Each hour has range 1 and the day has range 1."""
    return {day + i * c.HOUR_MS: (10.0, 9.0) for i in range(24)}


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    if not near(c.maxbar_at(stacked(day), day), 1.0 / 24.0):
        raise SystemExit("a stacked day did not score one hour over the day")
    if near(c.maxbar_at(stacked(day), day), 1.0):
        raise SystemExit("the sum of the hourly ranges replaced the widest hour")
    if not near(c.maxbar_at(overlap(day), day), 1.0):
        raise SystemExit("an overlapping day did not score one")
    if near(c.maxbar_at(overlap(day), day), 24.0):
        raise SystemExit("the sum of the hourly ranges replaced the widest hour")
    flat = {day + i * c.HOUR_MS: (10.0, 10.0) for i in range(24)}
    if c.maxbar_at(flat, day) is not None:
        raise SystemExit("a flat day was a print")
    missing = stacked(day)
    del missing[day + 13 * c.HOUR_MS]
    if c.maxbar_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.maxbar_at(stacked(later), later) is not None:
        raise SystemExit("a 2024 day was a print")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.2) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.9)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        hours.update(stacked(day) if i < 120 else overlap(day))
    last = start + 120 * c.fp5.DAY_MS
    if c.maxbar_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.maxbar_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp76 pins ok")


if __name__ == "__main__":
    main()
