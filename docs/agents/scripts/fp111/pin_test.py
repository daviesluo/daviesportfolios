"""Pins for the fp111 rule. No file and no return from 2023 is read."""

from __future__ import annotations

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

def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    if c.IDEA != "OIUSD":
        raise SystemExit("the idea moved")
    rows = {day: (100.0,)}
    if not near(c.signal_at(rows, day), 100.0):
        raise SystemExit("the level was wrong")
    both = {day - c.fp5.DAY_MS: (50.0,), day: (100.0,)}
    if not near(c.signal_at(both, day), 100.0):
        raise SystemExit("yesterday replaced the level")
    if near(c.signal_at(both, day), 1.0):
        raise SystemExit("the change replaced the level")
    if c.signal_at({day: (100.0, 1.0)}, day) is not None:
        raise SystemExit("a two-field row was a print")
    if c.signal_at({day: (0.0,)}, day) is not None:
        raise SystemExit("a non-positive value was a print")
    if c.signal_at({}, day) is not None:
        raise SystemExit("a missing day was a print")
    later = c.fp5.SCREEN_END_MS
    if c.signal_at({later: (100.0,)}, later) is not None:
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
    rows = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        rows[day] = (0.9 if i == 120 else 0.2,)
    last = start + 120 * c.fp5.DAY_MS
    if c.signal_days(rows) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    bars = {entry: (100.0,), exit_: (101.0,)}
    _expect_fill(c.signal_trades(rows, bars), entry)


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail_and_fill()
    print("fp111 pins ok")


if __name__ == "__main__":
    main()
