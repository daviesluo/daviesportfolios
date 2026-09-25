"""Pins for the fp59 rule. No file and no return from 2023 is read."""

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
    bars = [(10.0, 1.0)] * 24
    bars[0] = (10.0, 1_000_000.0)
    bars[1] = (11.0, 1.0)
    got = c.stepbase_at(day_hours(day, bars), day)
    if not near(got, 1.0 / 23.0):
        raise SystemExit("hour 0's base volume entered the share")
    doubled = list(bars)
    doubled[0] = (10.0, 2_000_000.0)
    if not near(c.stepbase_at(day_hours(day, doubled), day), got):
        raise SystemExit("changing hour 0's base volume changed the share")
    heavy = [(10.0, 0.0)] * 24
    heavy[0] = (10.0, 0.0)
    heavy[1] = (11.0, 5.0)
    heavy[3] = (12.0, 5.0)
    # closes: hour 2 is still 10, so hour 3's 12 beats 10. Two rising hours hold all the base.
    if not near(c.stepbase_at(day_hours(day, heavy), day), 1.0):
        raise SystemExit("base volume in the rising hours was not the whole share")
    hour_share = 2.0 / 23.0
    if near(c.stepbase_at(day_hours(day, heavy), day), hour_share):
        raise SystemExit("the count of rising hours replaced the base-volume share")
    missing = day_hours(day, bars)
    del missing[day + 13 * c.HOUR_MS]
    if c.stepbase_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.stepbase_at(day_hours(later, bars), later) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.stepbase_at(day_hours(later, bars), later, later + c.fp5.DAY_MS), 1.0 / 23.0):
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
        bars = [(10.0, 1.0)] * 24
        if i >= 120:
            bars = [(float(h + 1), 1.0) for h in range(24)]
        series.update(day_hours(day, bars))
    last = start + 120 * c.fp5.DAY_MS
    if c.stepbase_signal_days(series) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.stepbase_trades(daily, series) if t["entry_ms"] == entry]
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
    print("fp59 pins ok")


if __name__ == "__main__":
    main()
