"""Pins for the fp94 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9



def _rest(day: int, first: tuple[float, float], last: tuple[float, float]) -> dict[int, tuple]:
    return {day: first, day + 23 * c.HOUR_MS: last}


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    hours = _rest(day, (100.0, 150.0), (140.0, 150.0))
    if not near(c.rest_at(hours, day), 0.0):
        raise SystemExit("the last close over the first hour's close was wrong")
    if near(c.rest_at(hours, day), 0.5):
        raise SystemExit("the first hour's own return replaced the rest of the day")
    if near(c.rest_at(hours, day), 150.0 / 140.0 - 1.0):
        raise SystemExit("the last hour's own return replaced the rest of the day")
    if near(c.rest_at(hours, day), 150.0 / 100.0 - 1.0):
        raise SystemExit("the last close over the day's open replaced the rest of the day")
    kept = _rest(day, (100.0, 150.0), (140.0, 150.0))
    kept[day + 13 * c.HOUR_MS] = (1.0, 1.0)
    if not near(c.rest_at(kept, day), 0.0):
        raise SystemExit("hour 13 entered the rest of the day")
    del kept[day + 13 * c.HOUR_MS]
    kept[day + 6 * c.HOUR_MS] = (1.0, 9.0)
    if not near(c.rest_at(kept, day), 0.0):
        raise SystemExit("a missing middle hour was required")
    # hour 6 is present above; deleting it must still print.
    del kept[day + 6 * c.HOUR_MS]
    if not near(c.rest_at(kept, day), 0.0):
        raise SystemExit("a missing hour 6 dropped the day")
    no_last = _rest(day, (100.0, 150.0), (140.0, 150.0))
    del no_last[day + 23 * c.HOUR_MS]
    if c.rest_at(no_last, day) is not None:
        raise SystemExit("a missing last hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.rest_at(_rest(later, (100.0, 150.0), (140.0, 150.0)), later) is not None:
        raise SystemExit("a 2024 day was a print")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        if i < 120:
            hours.update(_rest(day, (100.0, 100.0), (100.0, 100.0)))
        else:
            hours.update(_rest(day, (100.0, 100.0), (100.0, 150.0)))
    last = start + 120 * c.fp5.DAY_MS
    if c.rest_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    _fill(c.rest_trades(daily, hours), entry)

def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.2) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.9)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def _fill(trades: list[dict], entry: int) -> None:
    filled = [t for t in trades if t["entry_ms"] == entry]
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
    print("fp94 pins ok")


if __name__ == "__main__":
    main()
