from __future__ import annotations
def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    prev = day - c.fp5.DAY_MS
    if c.IDEA != "RNGRAT":
        raise SystemExit("the idea moved")
    rows = {prev: (100.0, 105.0, 95.0), day: (100.0, 110.0, 90.0)}
    if not near(c.signal_at(rows, day), 1.0):
        raise SystemExit("the range jump was not the signal")
    if near(c.signal_at(rows, day), 0.2):
        raise SystemExit("today's range replaced the jump")
    if near(c.signal_at(rows, day), 0.1):
        raise SystemExit("yesterday's range replaced the jump")
    if c.signal_at({prev: (100.0, 100.0, 100.0), day: (100.0, 110.0, 90.0)}, day) is not None:
        raise SystemExit("a zero yesterday range was a print")
    if c.signal_at({day: (100.0, 110.0, 90.0)}, day) is not None:
        raise SystemExit("a day with no yesterday was a print")
    if c.signal_at({prev: (100.0, 101.0, 99.0), day: (100.0, 90.0, 110.0)}, day) is not None:
        raise SystemExit("a high under the low was a print")
    flat = {prev: (100.0, 110.0, 90.0), day: (200.0, 220.0, 180.0)}
    if not near(c.signal_at(flat, day), 0.0):
        raise SystemExit("equal ranges were not zero")
    if c.signal_prints(flat) != [(day, 0.0)]:
        raise SystemExit("a zero jump left the history")
    later = c.fp5.SCREEN_END_MS
    if c.signal_at({later - c.fp5.DAY_MS: (100.0, 101.0, 99.0), later: (100.0, 110.0, 90.0)}, later) is not None:
        raise SystemExit("a 2024 day was a print")

"""Pins for the fp141 rule. No file and no return from 2023 is read."""


import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-12


def _expect_fill(trades: list[dict], entry: int) -> None:
    filled = [t for t in trades if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit("entry must be the next daily open")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    if filled[0]["coin"] != "BTCUSDT":
        raise SystemExit("the fill is not BTC")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    rows = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        rows[day] = (100.0, 110.0, 90.0) if i == 120 else (100.0, 101.0, 99.0)
    last = start + 120 * c.fp5.DAY_MS
    if c.signal_days(rows) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    bars = {entry: (100.0,), entry + c.fp5.DAY_MS: (101.0,)}
    _expect_fill(c.signal_trades(rows, bars), entry)


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.2) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.9)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail_and_fill()
    print("fp141 pins ok")


if __name__ == "__main__":
    main()
