"""Pins for the fp93 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9



def _quiet(day: int) -> dict[int, tuple]:
    out = {day: (130.0, 100.0)}
    for i in range(1, 24):
        out[day + i * c.HOUR_MS] = (110.0, 105.0)
    return out


def _formula(day: int) -> dict[int, tuple]:
    out = {day: (130.0, 100.0), day + 23 * c.HOUR_MS: (112.0, 102.0)}
    for i in range(1, 23):
        out[day + i * c.HOUR_MS] = (110.0, 105.0)
    return out


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    if not near(c.tailbar_at(_formula(day), day), 1.0 / 3.0):
        raise SystemExit("the last hour's share of the day's range was wrong")
    if near(c.tailbar_at(_formula(day), day), 1.0):
        raise SystemExit("the widest hour replaced the last hour")
    if near(c.tailbar_at(_formula(day), day), 5.0):
        raise SystemExit("the sum of the ranges replaced the last hour")
    missing = _formula(day)
    del missing[day + 13 * c.HOUR_MS]
    if c.tailbar_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    flat = {day + i * c.HOUR_MS: (100.0, 100.0) for i in range(24)}
    if c.tailbar_at(flat, day) is not None:
        raise SystemExit("a flat day was a print")
    later = c.fp5.SCREEN_END_MS
    if c.tailbar_at(_formula(later), later) is not None:
        raise SystemExit("a 2024 day was a print")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        if i < 120:
            hours.update(_quiet(day))
        else:
            for h in range(24):
                t = day + h * c.HOUR_MS
                hours[t] = (130.0, 100.0) if h == 23 else (110.0, 105.0)
    last = start + 120 * c.fp5.DAY_MS
    if c.tailbar_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    _fill(c.tailbar_trades(daily, hours), entry)

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
    print("fp93 pins ok")


if __name__ == "__main__":
    main()
