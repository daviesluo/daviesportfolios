"""Pins for the fp91 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9



def _shaped(day: int, late_tie: bool = False) -> dict[int, tuple]:
    out = {}
    for i in range(24):
        t = day + i * c.HOUR_MS
        if i == 3:
            out[t] = (200.0, 80.0, 30.0)
        elif i == 7:
            out[t] = (100.0, 50.0, 10.0)
        elif i == 10 and late_tie:
            out[t] = (200.0, 60.0, 99.0)
        elif 4 <= i <= 6:
            out[t] = (150.0, 70.0, 2.0)
        else:
            out[t] = (120.0, 60.0, 1.0)
    return out


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    if not near(c.hlquote_at(_shaped(day), day), 3.0):
        raise SystemExit("the high hour's quote over the low hour's was wrong")
    if near(c.hlquote_at(_shaped(day), day), 30.0 / 65.0):
        raise SystemExit("the day's total quote replaced the low hour")
    if not near(c.hlquote_at(_shaped(day, late_tie=True), day), 3.0):
        raise SystemExit("a later tied high replaced the earlier hour")
    missing = _shaped(day)
    del missing[day + 13 * c.HOUR_MS]
    if c.hlquote_at(missing, day) is not None:
        raise SystemExit("a missing hour was a print")
    broken = _shaped(day)
    broken[day + 2 * c.HOUR_MS] = (50.0, 80.0, 1.0)
    if c.hlquote_at(broken, day) is not None:
        raise SystemExit("an hour with a high below its low was a print")
    later = c.fp5.SCREEN_END_MS
    if c.hlquote_at(_shaped(later), later) is not None:
        raise SystemExit("a 2024 day was a print")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        for h in range(24):
            t = day + h * c.HOUR_MS
            if i < 120:
                hours[t] = (110.0, 100.0, 1.0)
            elif h == 0:
                hours[t] = (200.0, 100.0, 50.0)
            elif h == 1:
                hours[t] = (150.0, 50.0, 1.0)
            else:
                hours[t] = (110.0, 80.0, 1.0)
    last = start + 120 * c.fp5.DAY_MS
    if c.hlquote_signal_days(hours) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    _fill(c.hlquote_trades(daily, hours), entry)

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
    print("fp91 pins ok")


if __name__ == "__main__":
    main()
