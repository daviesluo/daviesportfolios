"""Pins for the fp31 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def day_from_closes(day: int, closes: list[float]) -> dict[int, tuple]:
    if len(closes) != c.HOURS:
        raise SystemExit("a day needs 24 hours")
    return {day + k * c.HOUR_MS: (100.0, close) for k, close in enumerate(closes)}


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    even = day_from_closes(start, [101.0] * c.HOURS)
    if not near(c.hhi_at(even, start), 1.0 / c.HOURS):
        raise SystemExit("equal hourly moves were not 1/24")
    one = [100.0] * c.HOURS
    one[0] = 110.0
    if not near(c.hhi_at(day_from_closes(start, one), start), 1.0):
        raise SystemExit("a single moving hour was not 1")
    flipped = list(reversed(one))
    if c.hhi_at(day_from_closes(start, one), start) != c.hhi_at(day_from_closes(start, flipped), start):
        raise SystemExit("the hour order changed a Herfindahl")
    quoted = {t: bar + (1.0e9,) for t, bar in even.items()}
    if not near(c.hhi_at(quoted, start), 1.0 / c.HOURS):
        raise SystemExit("a volume field moved the Herfindahl")
    flat = day_from_closes(start, [100.0] * c.HOURS)
    if c.hhi_at(flat, start) is not None:
        raise SystemExit("a day without a move was a print")
    short = dict(even)
    del short[start + 2 * c.HOUR_MS]
    if c.hhi_at(short, start) is not None:
        raise SystemExit("a missing hour was a print")
    later = day_from_closes(c.fp5.SCREEN_END_MS, one)
    if c.hhi_at(later, c.fp5.SCREEN_END_MS) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.hhi_at(later, c.fp5.SCREEN_END_MS, c.fp5.SCREEN_END_MS + c.fp5.DAY_MS), 1.0):
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.2) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.21)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours: dict[int, tuple] = {}
    for i in range(121):
        closes = [101.0] * c.HOURS
        if i == 120:
            closes = [100.0] * c.HOURS
            closes[0] = 110.0
        hours.update(day_from_closes(start + i * c.fp5.DAY_MS, closes))
    last = start + 120 * c.fp5.DAY_MS
    if c.hhi_signal_days(hours) != [last]:
        raise SystemExit("a concentrated day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.hhi_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp31 pins ok")


if __name__ == "__main__":
    main()
