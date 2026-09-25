"""Pins for the fp73 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def day_bars(day: int, high_hour: int, before: float, at_high: float) -> dict[int, tuple]:
    """Bar is (high, quote). Hours before the high carry `before` each. The high hour carries `at_high`."""
    out = {}
    for i in range(24):
        t = day + i * c.HOUR_MS
        if i < high_hour:
            out[t] = (10.0, before)
        elif i == high_hour:
            out[t] = (20.0, at_high)
        else:
            out[t] = (10.0, 0.0)
    return out


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    bars = day_bars(day, 5, 1.0, 10.0)
    if not near(c.prequote_at(bars, day), 5.0 / 15.0):
        raise SystemExit("the quote share before the high was wrong")
    if near(c.prequote_at(bars, day), 5.0):
        raise SystemExit("the hour index replaced the quote share")
    if near(c.prequote_at(bars, day), 10.0 / 15.0):
        raise SystemExit("the high hour's own share replaced the share before it")
    early = day_bars(day, 0, 1.0, 10.0)
    if not near(c.prequote_at(early, day), 0.0):
        raise SystemExit("a high in hour 0 was not a zero print")
    tie = day_bars(day, 5, 1.0, 10.0)
    tie[day + 8 * c.HOUR_MS] = (20.0, 7.0)
    # Earlier high stays hour 5. Hour 8's quote is after it, so it is in the total only.
    if not near(c.prequote_at(tie, day), 5.0 / (15.0 + 7.0)):
        raise SystemExit("a tied high kept the later hour")
    missing = dict(bars)
    del missing[day + 3 * c.HOUR_MS]
    if c.prequote_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.prequote_at(day_bars(later, 5, 1.0, 10.0), later) is not None:
        raise SystemExit("a 2024 day was a print")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.2) for i in range(91)]
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
        if i < 120:
            hours.update(day_bars(day, 0, 1.0, 10.0))
        else:
            hours.update(day_bars(day, 23, 1.0, 1.0))
    last = start + 120 * c.fp5.DAY_MS
    if c.prequote_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.prequote_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp73 pins ok")


if __name__ == "__main__":
    main()
