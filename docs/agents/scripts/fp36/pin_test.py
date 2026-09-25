"""Pins for the fp36 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    nxt = start + c.fp5.DAY_MS
    daily = {start: (80.0, 110.0, 90.0), nxt: (100.0, 1.0, 1.0)}
    if not near(c.loc_at(daily, nxt), 0.5):
        raise SystemExit("an open in the middle of yesterday's range was not 0.5")
    daily[nxt] = (100.0, 500.0, 10.0)
    if not near(c.loc_at(daily, nxt), 0.5):
        raise SystemExit("today's own range moved the signal")
    daily[nxt] = (120.0, 1.0, 1.0)
    if not near(c.loc_at(daily, nxt), 1.5):
        raise SystemExit("an open above yesterday's high was not 1.5")
    flat = {start: (80.0, 100.0, 100.0), nxt: (100.0, 110.0, 90.0)}
    if c.loc_at(flat, nxt) is not None:
        raise SystemExit("a yesterday with no range was a print")
    later_day = c.fp5.SCREEN_END_MS
    later = {
        later_day - c.fp5.DAY_MS: (1.0, 110.0, 90.0),
        later_day: (100.0, 100.0, 100.0),
    }
    if c.loc_at(later, later_day) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.loc_at(later, later_day, later_day + c.fp5.DAY_MS), 0.5):
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.5) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.6)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    daily = {}
    for i in range(121):
        daily[start + i * c.fp5.DAY_MS] = (100.0, 110.0, 90.0)
    last = start + 120 * c.fp5.DAY_MS
    daily[last] = (130.0, 110.0, 90.0)
    if c.loc_signal_days(daily) != [last]:
        raise SystemExit("an open above yesterday's range did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily[entry] = (100.0, 110.0, 90.0)
    daily[exit_] = (101.0, 110.0, 90.0)
    if any(t["entry_ms"] == last for t in c.loc_trades(daily)):
        raise SystemExit("the signal open was the entry")
    filled = [t for t in c.loc_trades(daily) if t["entry_ms"] == entry]
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
    print("fp36 pins ok")


if __name__ == "__main__":
    main()
