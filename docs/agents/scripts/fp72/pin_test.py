"""Pins for the fp72 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def day_bars(day: int, low_hour: int, low_ret: float, other_ret: float) -> dict[int, tuple]:
    """Bar is (open, low, close). The low hour's low is 80. Every other low is 100."""
    out = {}
    for i in range(24):
        t = day + i * c.HOUR_MS
        if i == low_hour:
            out[t] = (100.0, 80.0, 100.0 * (1.0 + low_ret))
        else:
            out[t] = (100.0, 100.0, 100.0 * (1.0 + other_ret))
    return out


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    bars = day_bars(day, 2, -0.1, 0.5)
    if not near(c.lowret_at(bars, day), -0.1):
        raise SystemExit("the low hour's return was wrong")
    if near(c.lowret_at(bars, day), 0.5):
        raise SystemExit("another hour's return replaced the low hour")
    if near(c.lowret_at(bars, day), 2.0):
        raise SystemExit("the hour index replaced the return")
    tie = day_bars(day, 2, -0.1, 0.5)
    tie[day + 5 * c.HOUR_MS] = (100.0, 80.0, 150.0)
    if not near(c.lowret_at(tie, day), -0.1):
        raise SystemExit("a tied low kept the later hour")
    late = day_bars(day, 23, 0.2, -0.05)
    if not near(c.lowret_at(late, day), 0.2):
        raise SystemExit("a low in hour 23 was dropped")
    missing = dict(bars)
    del missing[day + 3 * c.HOUR_MS]
    if c.lowret_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.lowret_at(day_bars(later, 2, -0.1, 0.5), later) is not None:
        raise SystemExit("a 2024 day was a print")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, -0.01) for i in range(91)]
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
        hours.update(day_bars(day, 0, -0.01 if i < 120 else 0.2, -0.02))
    last = start + 120 * c.fp5.DAY_MS
    if c.lowret_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.lowret_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp72 pins ok")


if __name__ == "__main__":
    main()
