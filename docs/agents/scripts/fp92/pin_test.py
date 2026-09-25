"""Pins for the fp92 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9



def _ends(day: int, first: float = 80.0, last: float = 20.0, middle: bool = True) -> dict[int, tuple]:
    out = {day: (first,), day + 23 * c.HOUR_MS: (last,)}
    if middle:
        out[day + 5 * c.HOUR_MS] = (1000.0,)
    return out


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    if not near(c.ends_at(_ends(day), day), 4.0):
        raise SystemExit("the opening hour's quote over the last hour's was wrong")
    bare = _ends(day, middle=False)
    if not near(c.ends_at(bare, day), 4.0):
        raise SystemExit("a middle hour's quote entered the ratio")
    kept = _ends(day)
    kept[day + 13 * c.HOUR_MS] = (500.0,)
    if not near(c.ends_at(kept, day), 4.0):
        raise SystemExit("hour 13's quote entered the ratio")
    del kept[day + 13 * c.HOUR_MS]
    if not near(c.ends_at(kept, day), 4.0):
        raise SystemExit("a missing hour 13 dropped the day")
    no_open = _ends(day)
    del no_open[day]
    if c.ends_at(no_open, day) is not None:
        raise SystemExit("a missing opening hour was a print")
    no_last = _ends(day)
    del no_last[day + 23 * c.HOUR_MS]
    if c.ends_at(no_last, day) is not None:
        raise SystemExit("a missing last hour was a print")
    later = c.fp5.SCREEN_END_MS
    if c.ends_at(_ends(later), later) is not None:
        raise SystemExit("a 2024 day was a print")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        if i < 120:
            hours.update(_ends(day, 10.0, 10.0, middle=False))
        else:
            hours.update(_ends(day, 80.0, 10.0, middle=False))
    last = start + 120 * c.fp5.DAY_MS
    if c.ends_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    _fill(c.ends_trades(daily, hours), entry)

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
    print("fp92 pins ok")


if __name__ == "__main__":
    main()
