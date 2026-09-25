"""Pins for the fp71 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    # (open, high, low). The close is not stored.
    bars = {day: (50.0, 110.0, 10.0)}
    if not near(c.openin_at(bars, day), (50.0 - 10.0) / (110.0 - 10.0)):
        raise SystemExit("the open inside today's range was wrong")
    if near(c.openin_at(bars, day), 110.0 / 50.0 - 1.0):
        raise SystemExit("the open-to-high distance replaced the range location")
    if near(c.openin_at(bars, day), (50.0 - 10.0) / 50.0):
        raise SystemExit("the open-to-low distance replaced the range location")
    if c.openin_at({day: (50.0, 10.0, 10.0)}, day) is not None:
        raise SystemExit("a flat day was a print")
    later = c.fp5.SCREEN_END_MS
    if c.openin_at({later: (50.0, 110.0, 10.0)}, later) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(
        c.openin_at({later: (50.0, 110.0, 10.0)}, later, later + c.fp5.DAY_MS),
        0.4,
    ):
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.2) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.9)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    series = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        if i < 120:
            series[day] = (10.0, 20.0, 9.0)
        else:
            series[day] = (19.0, 20.0, 10.0)
    last = start + 120 * c.fp5.DAY_MS
    if c.openin_signal_days(series) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    book = dict(series)
    book[entry] = (100.0, 20.0, 9.0)
    book[exit_] = (101.0, 20.0, 9.0)
    filled = [t for t in c.openin_trades(book) if t["entry_ms"] == entry]
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
    print("fp71 pins ok")


if __name__ == "__main__":
    main()
