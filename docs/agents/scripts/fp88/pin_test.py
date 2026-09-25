"""Pins for the fp88 rule. No file and no return from 2023 is read."""

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
    # Yesterday's range is 10. Today's low is 120. Today's open and high are not inputs.
    daily = {prev: (40.0, 110.0, 100.0), day: (50.0, 200.0, 120.0)}
    if not near(c.hold_at(daily, day), 1.0):
        raise SystemExit("the low's hold above yesterday's high was wrong")
    if near(c.hold_at(daily, day), 120.0 / 100.0 - 1.0):
        raise SystemExit("today's low over yesterday's low replaced the hold")
    flat = {prev: (40.0, 100.0, 100.0), day: (50.0, 200.0, 120.0)}
    if c.hold_at(flat, day) is not None:
        raise SystemExit("a flat yesterday was a print")
    if c.hold_at({day: (50.0, 200.0, 120.0)}, day) is not None:
        raise SystemExit("a day with no yesterday was a print")
    later = c.fp5.SCREEN_END_MS
    if c.hold_at({later - c.fp5.DAY_MS: (40.0, 110.0, 100.0), later: (50.0, 200.0, 120.0)}, later) is not None:
        raise SystemExit("a 2024 day was a print")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    daily = {}
    for i in range(130):
        day = start + i * c.fp5.DAY_MS
        if i < 129:
            daily[day] = (100.0, 110.0, 100.0)
        else:
            daily[day] = (50.0, 140.0, 130.0)
    last = start + 129 * c.fp5.DAY_MS
    if c.hold_signal_days(daily) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily[entry] = (100.0, 110.0, 100.0)
    daily[exit_] = (101.0, 110.0, 100.0)
    _fill(c.hold_trades(daily), entry)

def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.2) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.9)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def _fill(trades: list[dict], entry: int) -> None:
    filled = [t for t in trades if t["entry_ms"] == entry]
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
    print("fp88 pins ok")


if __name__ == "__main__":
    main()
