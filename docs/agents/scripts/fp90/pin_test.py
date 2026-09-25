"""Pins for the fp90 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9



def _day(day: int, last: tuple[float, float] = (10.0, 10.0), hole: int | None = None) -> dict[int, tuple]:
    out = {}
    for i in range(24):
        if hole is not None and i == hole:
            continue
        out[day + i * c.HOUR_MS] = last if i == 23 else (10.0, 10.0)
    return out


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    hours = _day(day, (10.0, 2.0))
    if not near(c.lastsize_at(hours, day), 23.0 / 6.0):
        raise SystemExit("the last hour's average trade versus the day was wrong")
    if near(c.lastsize_at(hours, day), 240.0 / 232.0):
        raise SystemExit("the day's average trade replaced the ratio")
    if near(c.lastsize_at(hours, day), 5.0):
        raise SystemExit("the last hour's average trade level replaced the ratio")
    if not near(c.lastsize_at(_day(day), day), 0.0):
        raise SystemExit("a uniform day was not zero")
    if not near(c.lastsize_at(_day(day, (10.0, 1.0)), day), 8.625):
        raise SystemExit("a last hour of one trade was wrong")
    quiet_middle = _day(day, (10.0, 2.0))
    quiet_middle[day + 5 * c.HOUR_MS] = (0.0, 0.0)
    if c.lastsize_at(quiet_middle, day) is None:
        raise SystemExit("a middle hour with no trades dropped the day")
    missing = _day(day, hole=13)
    if c.lastsize_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    if c.lastsize_at(_day(day, (10.0, 0.0)), day) is not None:
        raise SystemExit("a last hour with no trades was a print")
    later = c.fp5.SCREEN_END_MS
    if c.lastsize_at(_day(later, (10.0, 2.0)), later) is not None:
        raise SystemExit("a 2024 day was a print")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        hours.update(_day(day, (10.0, 10.0) if i < 120 else (10.0, 1.0)))
    last = start + 120 * c.fp5.DAY_MS
    if c.lastsize_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    _fill(c.lastsize_trades(daily, hours), entry)

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
    print("fp90 pins ok")


if __name__ == "__main__":
    main()
