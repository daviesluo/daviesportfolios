"""Pins for the fp52 rule. No file and no return from 2023 is read."""

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
    prev = day - c.fp5.DAY_MS
    same = {prev: (1.0, 1_000_000.0), day: (1.0, 1_000_000.0)}
    if not near(c.qvol_at(same, day), 0.0):
        raise SystemExit("an unchanged quote was not zero")
    grown = {prev: (1.0, 100.0), day: (9.0, 200.0)}
    if not near(c.qvol_at(grown, day), 1.0):
        raise SystemExit("doubling quote was not 1")
    if c.qvol_at({prev: (1.0, 100.0), day: (1.0, 0.0)}, day) is not None:
        raise SystemExit("a zero quote was a print")
    if c.qvol_at({day: (1.0, 100.0)}, day) is not None:
        raise SystemExit("a missing yesterday was a print")
    later = c.fp5.SCREEN_END_MS
    horizon = {later - c.fp5.DAY_MS: (1.0, 100.0), later: (1.0, 250.0)}
    if c.qvol_at(horizon, later) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.qvol_at(horizon, later, later + c.fp5.DAY_MS), 1.5):
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.2) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.0)
    if c._upper(points, 0.90):
        raise SystemExit("a day that did not grow fired")
    points[-1] = (points[-1][0], 2.0)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    daily = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        quote = 400.0 if i == 120 else 100.0
        daily[day] = (50.0, quote)
    last = start + 120 * c.fp5.DAY_MS
    if c.qvol_signal_days(daily) != [last]:
        raise SystemExit("a quote rise did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily[entry] = (100.0, 100.0)
    daily[exit_] = (101.0, 100.0)
    filled = [t for t in c.qvol_trades(daily) if t["entry_ms"] == entry]
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
    print("fp52 pins ok")


if __name__ == "__main__":
    main()
