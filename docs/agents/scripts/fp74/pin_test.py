"""Pins for the fp74 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def day_bars(day: int, hour6_close: float) -> dict[int, tuple]:
    """Bar is (open, close). Hour 0 opens at 100 and closes at 150. Hour 6 closes at hour6_close."""
    out = {}
    for i in range(24):
        t = day + i * c.HOUR_MS
        if i == 0:
            out[t] = (100.0, 150.0)
        elif i == 6:
            out[t] = (100.0, hour6_close)
        else:
            out[t] = (100.0, 100.0)
    return out


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    bars = day_bars(day, 100.0)
    if not near(c.morning_at(bars, day), 0.0):
        raise SystemExit("the return from hour 0 to hour 6 was wrong")
    if near(c.morning_at(bars, day), 0.5):
        raise SystemExit("hour 0's own return replaced the block")
    wild = dict(bars)
    wild[day + 23 * c.HOUR_MS] = (100.0, 500.0)
    wild[day + 15 * c.HOUR_MS] = (100.0, 1.0)
    if not near(c.morning_at(wild, day), 0.0):
        raise SystemExit("an hour after 6 entered the signal")
    dropped = dict(bars)
    del dropped[day + 13 * c.HOUR_MS]
    if not near(c.morning_at(dropped, day), 0.0):
        raise SystemExit("a missing hour after 6 dropped the day")
    hole = dict(bars)
    del hole[day + 3 * c.HOUR_MS]
    if c.morning_at(hole, day) is not None:
        raise SystemExit("a missing hour inside 0 through 6 was a print")
    later = c.fp5.SCREEN_END_MS
    if c.morning_at(day_bars(later, 100.0), later) is not None:
        raise SystemExit("a 2024 day was a print")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.2)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        hours.update(day_bars(day, 100.0 if i < 120 else 120.0))
    last = start + 120 * c.fp5.DAY_MS
    if c.morning_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.morning_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp74 pins ok")


if __name__ == "__main__":
    main()
