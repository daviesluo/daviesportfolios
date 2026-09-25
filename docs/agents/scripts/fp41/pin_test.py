"""Pins for the fp41 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def closes(start: int, values: list[float], open_: float = 1.0) -> dict[int, tuple]:
    return {start + i * c.fp5.DAY_MS: (open_, value) for i, value in enumerate(values)}


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    third = start + 2 * c.fp5.DAY_MS
    if c.streak_at(closes(start, [100.0, 110.0, 120.0]), third) != 2:
        raise SystemExit("two rising closes were not a streak of 2")
    green = closes(start, [110.0, 105.0])
    green[start + c.fp5.DAY_MS] = (90.0, 105.0)
    if c.streak_at(green, start + c.fp5.DAY_MS) != 0:
        raise SystemExit("a green candle below the prior close extended the streak")
    last = start + 5 * c.fp5.DAY_MS
    if c.streak_at(closes(start, [100.0, 110.0, 120.0, 100.0, 110.0, 120.0]), last) != 2:
        raise SystemExit("a down close failed to reset the streak")
    opened = closes(start, [100.0, 110.0, 120.0], open_=999.0)
    if c.streak_at(opened, third) != 2:
        raise SystemExit("the open entered the streak")
    if c.streak_at(closes(start, [100.0, 100.0]), start + c.fp5.DAY_MS) != 0:
        raise SystemExit("an equal close counted as a rise")
    if c.streak_at(closes(start, [100.0]), start) is not None:
        raise SystemExit("a missing yesterday was a print")
    later_day = c.fp5.SCREEN_END_MS
    later = {later_day - c.fp5.DAY_MS: (1.0, 100.0), later_day: (1.0, 110.0)}
    if c.streak_at(later, later_day) is not None:
        raise SystemExit("a 2024 day was a print")
    if c.streak_at(later, later_day, later_day + c.fp5.DAY_MS) != 1:
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 1.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 2.0)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")
    points = [(i * c.fp5.DAY_MS, -1.0) for i in range(91)]
    points[-1] = (points[-1][0], 0.0)
    if c._upper(points, 0.90):
        raise SystemExit("a day that did not rise fired")



def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS

    daily = closes(start, [100.0] * 120 + [101.0])
    last = start + 120 * c.fp5.DAY_MS
    if c.streak_signal_days(daily) != [last]:
        raise SystemExit("a rising close did not fire on its own")

    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily[entry] = (100.0, 50.0)
    daily[exit_] = (101.0, 40.0)

    filled = [t for t in c.streak_trades(daily) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit("entry must be the next daily open")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    if filled[0]["coin"] != "BTCUSDT":
        raise SystemExit("the coin is not BTC")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail_and_fill()
    print("fp41 pins ok")


if __name__ == "__main__":
    main()
