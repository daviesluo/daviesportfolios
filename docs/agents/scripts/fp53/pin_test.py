"""Pins for the fp53 rule. No file and no return from 2023 is read."""

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
    # A huge range inside one hour is still a gap of 0.
    wide = [(100.0, 1.0)] + [(50.0, 40.0)] * 23
    if not near(c.gap_at(day_hours(day, wide), day), 0.0):
        raise SystemExit("the price range entered the signal")
    bars = [(10.0, 9.0)] * 24
    bars[0] = (10.0, 1.0)
    bars[23] = (100.0, 9.0)
    if not near(c.gap_at(day_hours(day, bars), day), 23.0):
        raise SystemExit("a low at 0 and a high at 23 was not 23")
    scaled = [(high * 10.0, low * 10.0) for high, low in bars]
    if not near(c.gap_at(day_hours(day, scaled), day), 23.0):
        raise SystemExit("scaling the prices changed the gap")
    tied = [(5.0, 4.0)] * 24
    tied[3] = (9.0, 1.0)
    tied[18] = (9.0, 1.0)
    if not near(c.gap_at(day_hours(day, tied), day), 0.0):
        raise SystemExit("a tie did not keep the earliest hour")
    missing = day_hours(day, bars)
    del missing[day + 7 * c.HOUR_MS]
    if c.gap_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.gap_at(day_hours(later, bars), later) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.gap_at(day_hours(later, bars), later, later + c.fp5.DAY_MS), 23.0):
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
    hours = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        bars = [(10.0, 9.0)] * 24
        if i == 120:
            bars[0] = (10.0, 1.0)
            bars[23] = (100.0, 9.0)
        else:
            bars[0] = (10.0, 1.0)
            bars[1] = (100.0, 9.0)
        hours.update(day_hours(day, bars))
    last = start + 120 * c.fp5.DAY_MS
    if c.gap_signal_days(hours) != [last]:
        raise SystemExit("a wide clock gap did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.gap_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp53 pins ok")


if __name__ == "__main__":
    main()
