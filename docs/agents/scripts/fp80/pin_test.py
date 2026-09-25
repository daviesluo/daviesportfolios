"""Pins for the fp80 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def bar(open_: float, high: float, low: float, quote: float, base: float) -> tuple:
    return (open_, high, low, quote, base)


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    # VWAP 110, range 100 to 120. Open sits at 50 and is not an input.
    daily = {day: bar(50.0, 120.0, 100.0, 11000.0, 100.0)}
    if not near(c.vwaploc_at(daily, day), 0.5):
        raise SystemExit("VWAP's place in the range was wrong")
    if near(c.vwaploc_at(daily, day), 110.0 / 50.0 - 1.0):
        raise SystemExit("VWAP over the open replaced the location")
    if near(c.vwaploc_at(daily, day), (50.0 - 100.0) / (120.0 - 100.0)):
        raise SystemExit("the open's place in the range replaced the VWAP")
    flat = {day: bar(100.0, 100.0, 100.0, 100.0, 1.0)}
    if c.vwaploc_at(flat, day) is not None:
        raise SystemExit("a flat day was a print")
    empty = {day: bar(100.0, 120.0, 100.0, 0.0, 100.0)}
    if c.vwaploc_at(empty, day) is not None:
        raise SystemExit("a day with no quote was a print")
    later = c.fp5.SCREEN_END_MS
    if c.vwaploc_at({later: bar(50.0, 120.0, 100.0, 11000.0, 100.0)}, later) is not None:
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
    daily = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        quote = 10200.0 if i < 120 else 10900.0
        daily[day] = bar(100.0, 110.0, 100.0, quote, 100.0)
    last = start + 120 * c.fp5.DAY_MS
    if c.vwaploc_signal_days(daily) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily[entry] = bar(100.0, 110.0, 100.0, 10200.0, 100.0)
    daily[exit_] = bar(101.0, 110.0, 100.0, 10200.0, 100.0)
    filled = [t for t in c.vwaploc_trades(daily) if t["entry_ms"] == entry]
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
    print("fp80 pins ok")


if __name__ == "__main__":
    main()
