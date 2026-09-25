"""Pins for the fp84 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def day_bars(day: int, busy: float) -> dict[int, tuple]:
    """Bar is (open, close, quote). Hour 0 returns +1 on quote 1. The other hours return `busy` on quote 100."""
    out = {}
    for i in range(24):
        t = day + i * c.HOUR_MS
        if i == 0:
            out[t] = (100.0, 200.0, 1.0)
        else:
            out[t] = (100.0, 100.0 * (1.0 + busy), 100.0)
    return out


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    bars = day_bars(day, 0.0)
    want = 1.0 / 2301.0
    if not near(c.wtd_at(bars, day), want):
        raise SystemExit("the quote-weighted return was wrong")
    if near(c.wtd_at(bars, day), 0.0):
        raise SystemExit("the busiest hour's return replaced the weighted mean")
    if near(c.wtd_at(bars, day), 1.0 / 24.0):
        raise SystemExit("an equal weight replaced the quote weight")
    missing = dict(bars)
    del missing[day + 13 * c.HOUR_MS]
    if c.wtd_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.wtd_at(day_bars(later, 0.0), later) is not None:
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
        hours.update(day_bars(day, 0.0 if i < 120 else 0.05))
    last = start + 120 * c.fp5.DAY_MS
    if c.wtd_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.wtd_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp84 pins ok")


if __name__ == "__main__":
    main()
