"""Pins for the fp38 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def hours_of(day: int, closes: list[float], scale: float = 1.0, extra: float | None = None) -> dict[int, tuple]:
    hours = {}
    for k, close in enumerate(closes):
        bar = (100.0 * scale, close * scale) if extra is None else (100.0 * scale, close * scale, extra)
        hours[day + k * c.HOUR_MS] = bar
    return hours


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    loud = [100.0] * 24
    loud[11] = 110.0
    loud[23] = 130.0
    if not near(c.half_at(hours_of(start, loud), start), 0.2):
        raise SystemExit("the second half did not outrun the first by 0.2")
    both = [100.0] * 24
    both[11] = 110.0
    both[23] = 110.0
    if not near(c.half_at(hours_of(start, both), start), 0.0):
        raise SystemExit("two equal halves were not a flat difference")
    moved = hours_of(start, loud)
    moved[start + 5 * c.HOUR_MS] = (100.0, 999.0)
    if not near(c.half_at(moved, start), 0.2):
        raise SystemExit("a middle hour entered the half difference")
    if not near(c.half_at(hours_of(start, loud, extra=1e9), start), 0.2):
        raise SystemExit("a quote field entered the half difference")
    if not near(c.half_at(hours_of(start, loud, scale=4.0), start), 0.2):
        raise SystemExit("scaling the path changed the half difference")
    short = hours_of(start, loud)
    del short[start + 5 * c.HOUR_MS]
    if c.half_at(short, start) is not None:
        raise SystemExit("a missing hour was a print")
    later = hours_of(c.fp5.SCREEN_END_MS, loud)
    if c.half_at(later, c.fp5.SCREEN_END_MS) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.half_at(later, c.fp5.SCREEN_END_MS, c.fp5.SCREEN_END_MS + c.fp5.DAY_MS), 0.2):
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

    quiet = [100.0] * 24
    loud = [100.0] * 24
    loud[23] = 110.0
    hours: dict[int, tuple] = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        closes = loud if i == 120 else quiet
        hours.update(hours_of(day, closes))
    last = start + 120 * c.fp5.DAY_MS
    if c.half_signal_days(hours) != [last]:
        raise SystemExit("a second-half day did not fire on its own")

    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}

    filled = [t for t in c.half_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp38 pins ok")


if __name__ == "__main__":
    main()
