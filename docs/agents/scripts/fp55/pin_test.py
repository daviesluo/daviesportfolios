"""Pins for the fp55 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9



def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    # (open, low, close). The open is not the signal. The high is not stored.
    if not near(c.bounce_at({day: (100.0, 50.0, 80.0)}, day), 80.0 / 50.0 - 1.0):
        raise SystemExit("close over low was wrong")
    if not near(c.bounce_at({day: (999.0, 50.0, 80.0)}, day), 80.0 / 50.0 - 1.0):
        raise SystemExit("the open entered the signal")
    loc = (80.0 - 50.0) / (1000.0 - 50.0)
    if near(c.bounce_at({day: (100.0, 50.0, 80.0)}, day), loc):
        raise SystemExit("the high-low range entered the signal")
    if not near(c.bounce_at({day: (10.0, 10.0, 10.0)}, day), 0.0):
        raise SystemExit("a close on the low was not flat")
    if c.bounce_at({day: (10.0, 0.0, 10.0)}, day) is not None:
        raise SystemExit("a non-positive low was a print")
    later = c.fp5.SCREEN_END_MS
    if c.bounce_at({later: (10.0, 5.0, 9.0)}, later) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.bounce_at({later: (10.0, 5.0, 9.0)}, later, later + c.fp5.DAY_MS), 9.0 / 5.0 - 1.0):
        raise SystemExit("a later horizon still dropped the 2024 day")

def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 2.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 20.0)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    series = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        if i == 0:
            series[day] = (10.0, 10.0, 10.0)
        elif i < 120:
            series[day] = (10.0, 10.0, 10.0)
        else:
            series[day] = (10.0, 10.0, 20.0)
    last = start + 120 * c.fp5.DAY_MS
    if c.bounce_signal_days(series) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    book = dict(series)
    book[entry] = (100.0,) + series[last][1:]
    book[exit_] = (101.0,) + series[last][1:]
    filled = [t for t in c.bounce_trades(book) if t["entry_ms"] == entry]
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
    print("fp55 pins ok")


if __name__ == "__main__":
    main()
