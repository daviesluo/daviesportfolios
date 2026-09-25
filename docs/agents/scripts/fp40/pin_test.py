"""Pins for the fp40 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def low_day(day: int, lows: list[float], extra: float | None = None) -> dict[int, tuple]:
    hours = {}
    for k, low in enumerate(lows):
        hours[day + k * c.HOUR_MS] = (low,) if extra is None else (low, extra)
    return hours


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    rising = [100.0 + k for k in range(24)]
    if c.lows_at(low_day(start, rising), start) != 23:
        raise SystemExit("a rising low was not 23 lifts")
    if c.lows_at(low_day(start, [100.0] * 24), start) != 0:
        raise SystemExit("an equal low counted as a lift")
    plateau = [100.0 + k for k in range(24)]
    plateau[5] = plateau[4]
    if c.lows_at(low_day(start, plateau), start) != 22:
        raise SystemExit("a flat step still counted")
    if c.lows_at(low_day(start, rising, extra=1.0), start) != 23:
        raise SystemExit("a second field entered the low count")
    short = low_day(start, rising)
    del short[start + 2 * c.HOUR_MS]
    if c.lows_at(short, start) is not None:
        raise SystemExit("a missing hour was a print")
    later = low_day(c.fp5.SCREEN_END_MS, rising)
    if c.lows_at(later, c.fp5.SCREEN_END_MS) is not None:
        raise SystemExit("a 2024 day was a print")
    if c.lows_at(later, c.fp5.SCREEN_END_MS, c.fp5.SCREEN_END_MS + c.fp5.DAY_MS) != 23:
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 1.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 2.0)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")



def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS

    hours: dict[int, tuple] = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        lows = [100.0 + k for k in range(24)] if i == 120 else [100.0] * 24
        hours.update(low_day(day, lows))
    last = start + 120 * c.fp5.DAY_MS
    if c.lows_signal_days(hours) != [last]:
        raise SystemExit("a day of higher lows did not fire on its own")

    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}

    filled = [t for t in c.lows_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp40 pins ok")


if __name__ == "__main__":
    main()
