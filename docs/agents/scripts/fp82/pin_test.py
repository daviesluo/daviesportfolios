"""Pins for the fp82 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def day_bars(day: int, at: int) -> dict[int, tuple]:
    """Bar is (quote,). One hour carries the whole day."""
    out = {}
    for i in range(24):
        t = day + i * c.HOUR_MS
        out[t] = (1.0 if i == at else 0.0,)
    return out


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    if not near(c.noon_at(day_bars(day, 14), day), 1.0):
        raise SystemExit("quote inside hours 12 through 17 was not the whole share")
    if c.noon_at(day_bars(day, 18), day) != 0.0:
        raise SystemExit("quote in hour 18 entered the block")
    if c.noon_at(day_bars(day, 5), day) != 0.0:
        raise SystemExit("quote in the first hours entered the block")
    if near(c.noon_at(day_bars(day, 14), day), 14.0):
        raise SystemExit("the hour index replaced the share")
    missing_block = day_bars(day, 14)
    del missing_block[day + 13 * c.HOUR_MS]
    if c.noon_at(missing_block, day) is not None:
        raise SystemExit("a missing hour inside the block was a print")
    missing_late = day_bars(day, 14)
    del missing_late[day + 20 * c.HOUR_MS]
    if c.noon_at(missing_late, day) is not None:
        raise SystemExit("a missing hour outside the block was a print")
    later = c.fp5.SCREEN_END_MS
    if c.noon_at(day_bars(later, 14), later) is not None:
        raise SystemExit("a 2024 day was a print")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.25) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.9)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        hours.update(day_bars(day, 5 if i < 120 else 14))
    last = start + 120 * c.fp5.DAY_MS
    if c.noon_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.noon_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp82 pins ok")


if __name__ == "__main__":
    main()
