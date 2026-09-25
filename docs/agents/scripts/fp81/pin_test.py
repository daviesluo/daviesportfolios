"""Pins for the fp81 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def day_bars(day: int, jump: float) -> dict[int, tuple]:
    """Bar is (open, close). Hour 5 opens `jump` above hour 4's close. Hour 0 opens at 100."""
    out = {}
    for i in range(24):
        t = day + i * c.HOUR_MS
        out[t] = (100.0, 100.0)
    out[day + 4 * c.HOUR_MS] = (100.0, 100.0)
    out[day + 5 * c.HOUR_MS] = (100.0 * (1.0 + jump), 100.0 * (1.0 + jump))
    out[day + 1 * c.HOUR_MS] = (110.0, 110.0)
    out[day] = (100.0, 100.0)
    return out


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    bars = day_bars(day, 0.3)
    if not near(c.maxgap_at(bars, day), 0.3):
        raise SystemExit("the largest intraday gap was wrong")
    if near(c.maxgap_at(bars, day), 0.1):
        raise SystemExit("a smaller gap replaced the largest")
    if near(c.maxgap_at(bars, day), 100.0 / 50.0 - 1.0):
        raise SystemExit("a gap against yesterday's close replaced the intraday gap")
    missing = dict(bars)
    del missing[day + 13 * c.HOUR_MS]
    if c.maxgap_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.maxgap_at(day_bars(later, 0.3), later) is not None:
        raise SystemExit("a 2024 day was a print")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.01) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.05)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        hours.update(day_bars(day, 0.01 if i < 120 else 0.3))
    last = start + 120 * c.fp5.DAY_MS
    if c.maxgap_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.maxgap_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp81 pins ok")


if __name__ == "__main__":
    main()
