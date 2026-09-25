"""Pins for the fp83 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def day_bars(day: int) -> dict[int, tuple]:
    """Bar is (open, high, close). Hour 0 opens at 100. Hour 3 has the high and closes at 110."""
    out = {}
    for i in range(24):
        t = day + i * c.HOUR_MS
        out[t] = (100.0, 150.0, 100.0)
    out[day] = (100.0, 140.0, 100.0)
    out[day + 3 * c.HOUR_MS] = (100.0, 200.0, 110.0)
    out[day + 4 * c.HOUR_MS] = (100.0, 160.0, 150.0)
    out[day + 8 * c.HOUR_MS] = (100.0, 180.0, 180.0)
    return out


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    bars = day_bars(day)
    if not near(c.highclose_at(bars, day), 0.1):
        raise SystemExit("the high hour's close over the open was wrong")
    if near(c.highclose_at(bars, day), 200.0 / 100.0 - 1.0):
        raise SystemExit("the high price replaced that hour's close")
    if near(c.highclose_at(bars, day), 3.0):
        raise SystemExit("the hour index replaced the close")
    if near(c.highclose_at(bars, day), 150.0 / 100.0 - 1.0):
        raise SystemExit("the next hour's close replaced the high hour")
    tied = dict(bars)
    tied[day + 9 * c.HOUR_MS] = (100.0, 200.0, 180.0)
    if not near(c.highclose_at(tied, day), 0.1):
        raise SystemExit("a tie did not keep the earlier hour")
    missing = dict(bars)
    del missing[day + 13 * c.HOUR_MS]
    if c.highclose_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.highclose_at(day_bars(later), later) is not None:
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
        close = 100.0 if i < 120 else 140.0
        for h in range(24):
            t = day + h * c.HOUR_MS
            hours[t] = (100.0, 110.0, 100.0)
        hours[day + 3 * c.HOUR_MS] = (100.0, 200.0, close)
    last = start + 120 * c.fp5.DAY_MS
    if c.highclose_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.highclose_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp83 pins ok")


if __name__ == "__main__":
    main()
