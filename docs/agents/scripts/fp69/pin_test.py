"""Pins for the fp69 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def day_hours(day: int, bars: list[tuple[float, float]]) -> dict[int, tuple]:
    return {day + i * c.HOUR_MS: bars[i] for i in range(24)}


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    lows = [(100.0, 100.0 - i) for i in range(24)]
    if not near(c.expand_at(day_hours(day, lows), day), 23.0):
        raise SystemExit("a day of new lows was not 23")
    highs = [(10.0, 8.0), (9.0, 8.0), (11.0, 8.0)] + [(11.0, 8.0)] * 21
    if not near(c.expand_at(day_hours(day, highs), day), 1.0):
        raise SystemExit("a high that only beat the previous hour was counted")
    both = [(10.0, 9.0), (11.0, 8.0)] + [(11.0, 8.0)] * 22
    if not near(c.expand_at(day_hours(day, both), day), 1.0):
        raise SystemExit("an hour that extended both sides was counted twice")
    missing = day_hours(day, lows)
    del missing[day + 13 * c.HOUR_MS]
    if c.expand_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.expand_at(day_hours(later, lows), later) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.expand_at(day_hours(later, lows), later, later + c.fp5.DAY_MS), 23.0):
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
        if i < 120:
            bars = [(10.0, 9.0)] * 24
        else:
            bars = [(100.0, 100.0 - h) for h in range(24)]
        series.update(day_hours(day, bars))
    last = start + 120 * c.fp5.DAY_MS
    if c.expand_signal_days(series) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.expand_trades(daily, series) if t["entry_ms"] == entry]
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
    print("fp69 pins ok")


if __name__ == "__main__":
    main()
