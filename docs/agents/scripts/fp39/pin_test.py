"""Pins for the fp39 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def hl_day(day: int, pairs: list[tuple[float, float]]) -> dict[int, tuple]:
    return {day + k * c.HOUR_MS: pair for k, pair in enumerate(pairs)}


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    nested = [(110.0, 90.0)] * 24
    if c.inside_at(hl_day(start, nested), start) != 23:
        raise SystemExit("a day of identical ranges was not 23 inside hours")
    wide = [(200.0, 50.0)] * 24
    if c.inside_at(hl_day(start, wide), start) != 23:
        raise SystemExit("the range width changed the inside count")
    expanding = [(100.0 + k, 90.0 - k) for k in range(24)]
    if c.inside_at(hl_day(start, expanding), start) != 0:
        raise SystemExit("an expanding day had an inside hour")
    short = hl_day(start, nested)
    del short[start + 3 * c.HOUR_MS]
    if c.inside_at(short, start) is not None:
        raise SystemExit("a missing hour was a print")
    later = hl_day(c.fp5.SCREEN_END_MS, nested)
    if c.inside_at(later, c.fp5.SCREEN_END_MS) is not None:
        raise SystemExit("a 2024 day was a print")
    if c.inside_at(later, c.fp5.SCREEN_END_MS, c.fp5.SCREEN_END_MS + c.fp5.DAY_MS) != 23:
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
        pairs = [(110.0, 90.0)] * 24 if i == 120 else [(100.0 + k, 90.0 - k) for k in range(24)]
        hours.update(hl_day(day, pairs))
    last = start + 120 * c.fp5.DAY_MS
    if c.inside_signal_days(hours) != [last]:
        raise SystemExit("a nested day did not fire on its own")

    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}

    filled = [t for t in c.inside_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp39 pins ok")


if __name__ == "__main__":
    main()
