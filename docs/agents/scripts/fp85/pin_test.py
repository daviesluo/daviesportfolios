"""Pins for the fp85 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def day_bars(day: int, typical: float) -> dict[int, tuple]:
    """Bar is (open, close). One close is 50, the last close is 200, the other 22 closes are `typical`."""
    out = {}
    for i in range(24):
        t = day + i * c.HOUR_MS
        out[t] = (100.0, typical)
    out[day + 4 * c.HOUR_MS] = (100.0, 50.0)
    out[day + 23 * c.HOUR_MS] = (100.0, 200.0)
    out[day] = (100.0, typical)
    return out


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    bars = day_bars(day, 110.0)
    if not near(c.medopen_at(bars, day), 0.1):
        raise SystemExit("the lower median over the open was wrong")
    if near(c.medopen_at(bars, day), 50.0 / 100.0 - 1.0):
        raise SystemExit("the lowest close replaced the median")
    if near(c.medopen_at(bars, day), 200.0 / 100.0 - 1.0):
        raise SystemExit("the last close replaced the median")
    mean = (50.0 + 22.0 * 110.0 + 200.0) / 24.0
    if near(c.medopen_at(bars, day), mean / 100.0 - 1.0):
        raise SystemExit("the mean close replaced the median")
    missing = dict(bars)
    del missing[day + 13 * c.HOUR_MS]
    if c.medopen_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.medopen_at(day_bars(later, 110.0), later) is not None:
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
        hours.update(day_bars(day, 100.0 if i < 120 else 150.0))
    last = start + 120 * c.fp5.DAY_MS
    if c.medopen_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.medopen_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp85 pins ok")


if __name__ == "__main__":
    main()
