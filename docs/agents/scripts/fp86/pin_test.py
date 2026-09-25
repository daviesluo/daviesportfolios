"""Pins for the fp86 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def shifted(day: int) -> dict[int, tuple]:
    """Bar is (high, low). Each next hour shares 9 of a range of 11 with the previous."""
    out = {}
    for i in range(24):
        t = day + i * c.HOUR_MS
        out[t] = (110.0 + i, 100.0 + i)
    return out


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    if not near(c.overlap_at(shifted(day), day), 9.0 / 11.0):
        raise SystemExit("the mean overlap was wrong")
    if near(c.overlap_at(shifted(day), day), 0.0):
        raise SystemExit("a partial overlap was treated as a miss")
    if near(c.overlap_at(shifted(day), day), 240.0 / 33.0):
        raise SystemExit("the sum of ranges over the day's range replaced the overlap")
    if near(c.overlap_at(shifted(day), day), 10.0 / 33.0):
        raise SystemExit("the widest hour over the day's range replaced the overlap")
    missing = shifted(day)
    del missing[day + 13 * c.HOUR_MS]
    if c.overlap_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.overlap_at(shifted(later), later) is not None:
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
        if i < 120:
            hours.update(shifted(day))
        else:
            for h in range(24):
                hours[day + h * c.HOUR_MS] = (200.0, 100.0)
    last = start + 120 * c.fp5.DAY_MS
    if c.overlap_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.overlap_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp86 pins ok")


if __name__ == "__main__":
    main()
