"""Pins for the fp42 rule. No file and no return from 2023 is read."""

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
    if not near(c.amihud_at({start: (100.0, 110.0, 1000.0)}, start), 0.0001):
        raise SystemExit("a 10 percent move on 1000 of quote was not 0.0001")
    if not near(c.amihud_at({start: (100.0, 90.0, 1000.0)}, start), 0.0001):
        raise SystemExit("the sign of the move entered Amihud")
    if not near(c.amihud_at({start: (100.0, 110.0, 2000.0)}, start), 0.00005):
        raise SystemExit("doubling quote volume did not halve Amihud")
    small = c.amihud_at({start: (100.0, 110.0, 1000.0)}, start)
    large = c.amihud_at({start: (100.0, 120.0, 1000.0)}, start)
    if small is None or large is None or not large > small:
        raise SystemExit("the same quote volume did not rank a larger move higher")
    if c.amihud_at({start: (100.0, 100.0, 1_000_000.0)}, start) != 0.0:
        raise SystemExit("a flat day with huge volume was not zero")
    if c.amihud_at({start: (100.0, 110.0, 0.0)}, start) is not None:
        raise SystemExit("a zero quote was a print")
    later = c.fp5.SCREEN_END_MS
    if c.amihud_at({later: (100.0, 110.0, 1000.0)}, later) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.amihud_at({later: (100.0, 110.0, 1000.0)}, later, later + c.fp5.DAY_MS), 0.0001):
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 1.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 2.0)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")



def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS

    daily = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        close = 110.0 if i == 120 else 100.0
        daily[day] = (100.0, close, 1000.0)
    last = start + 120 * c.fp5.DAY_MS
    if c.amihud_signal_days(daily) != [last]:
        raise SystemExit("a high Amihud day did not fire on its own")

    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily[entry] = (100.0, 100.0, 1000.0)
    daily[exit_] = (101.0, 101.0, 1000.0)

    filled = [t for t in c.amihud_trades(daily) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit("entry must be the next daily open")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    if filled[0]["coin"] != "BTCUSDT":
        raise SystemExit("the coin is not BTC")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail_and_fill()
    print("fp42 pins ok")


if __name__ == "__main__":
    main()
