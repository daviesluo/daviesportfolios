"""Pins for the fp89 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9



def _day(day: int, special: dict[int, tuple] | None = None) -> dict[int, tuple]:
    out = {}
    for i in range(24):
        out[day + i * c.HOUR_MS] = (100.0, 100.0)
    if special:
        for i, bar in special.items():
            out[day + i * c.HOUR_MS] = bar
    return out


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    hours = _day(day, {4: (200.0, 160.0), 9: (80.0, 76.0)})
    if not near(c.worst_at(hours, day), -0.2):
        raise SystemExit("the worst hourly return was wrong")
    if near(c.worst_at(hours, day), -0.05):
        raise SystemExit("the hour of the minimum close replaced the worst return")
    if near(c.worst_at(hours, day), 76.0 / 100.0 - 1.0):
        raise SystemExit("the minimum close over the day's scale replaced the worst return")
    missing = _day(day)
    del missing[day + 13 * c.HOUR_MS]
    if c.worst_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.worst_at(_day(later), later) is not None:
        raise SystemExit("a 2024 day was a print")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        if i < 120:
            hours.update(_day(day, {0: (100.0, 50.0)}))
        else:
            hours.update(_day(day))
    last = start + 120 * c.fp5.DAY_MS
    if c.worst_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    _fill(c.worst_trades(daily, hours), entry)

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
    print("fp89 pins ok")


if __name__ == "__main__":
    main()
