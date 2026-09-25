"""Pins for the fp32 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def day_from_quotes(day: int, quotes: list[float]) -> dict[int, tuple]:
    if len(quotes) != c.HOURS:
        raise SystemExit("a day needs 24 hours")
    return {day + k * c.HOUR_MS: (quote,) for k, quote in enumerate(quotes)}


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    flat = [1.0] * c.HOURS
    if not near(c.late_at(day_from_quotes(start, flat), start), 0.0):
        raise SystemExit("equal blocks were not 0")
    heavy = list(flat)
    for k in range(c.LATE, c.HOURS):
        heavy[k] = 3.0
    if not near(c.late_at(day_from_quotes(start, heavy), start), 2.0):
        raise SystemExit("a late block three times the early block was not 2")
    middle = list(flat)
    middle[12] = 1.0e6
    if not near(c.late_at(day_from_quotes(start, middle), start), 0.0):
        raise SystemExit("the middle of the day moved the ratio")
    scaled = [q * 9 for q in heavy]
    if not near(c.late_at(day_from_quotes(start, scaled), start), 2.0):
        raise SystemExit("scaling every hour changed the ratio")
    short = day_from_quotes(start, flat)
    del short[start + 12 * c.HOUR_MS]
    if c.late_at(short, start) is not None:
        raise SystemExit("a missing middle hour was a print")
    empty = list(flat)
    for k in range(c.EARLY):
        empty[k] = 0.0
    if c.late_at(day_from_quotes(start, empty), start) is not None:
        raise SystemExit("an empty early block was a print")
    later = day_from_quotes(c.fp5.SCREEN_END_MS, heavy)
    if c.late_at(later, c.fp5.SCREEN_END_MS) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.late_at(later, c.fp5.SCREEN_END_MS, c.fp5.SCREEN_END_MS + c.fp5.DAY_MS), 2.0):
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.1)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")
    points[-1] = (points[-1][0], -0.5)
    if c._upper(points, 0.90):
        raise SystemExit("a quiet late session was returned")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours: dict[int, tuple] = {}
    for i in range(121):
        quotes = [1.0] * c.HOURS
        if i == 120:
            for k in range(c.LATE, c.HOURS):
                quotes[k] = 3.0
        hours.update(day_from_quotes(start + i * c.fp5.DAY_MS, quotes))
    last = start + 120 * c.fp5.DAY_MS
    if c.late_signal_days(hours) != [last]:
        raise SystemExit("a late-heavy day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.late_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp32 pins ok")


if __name__ == "__main__":
    main()
