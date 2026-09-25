"""Pins for the fp109 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-12


def _day(day: int, a: float, b: float, c_: float) -> dict[int, float]:
    return {
        day: a,
        day + c.fp5.EIGHT_H_MS: b,
        day + 2 * c.fp5.EIGHT_H_MS: c_,
    }


def test_formula() -> None:
    day = c.fp5.SCREEN_START_MS
    funding = _day(day, -0.01, 0.0, 0.01)
    if not near(c.frng_at(funding, day), 0.02):
        raise SystemExit("the funding range was wrong")
    if near(c.frng_at(funding, day), -0.01):
        raise SystemExit("the low funding print replaced the range")
    if near(c.frng_at(funding, day), 0.01):
        raise SystemExit("the high funding print replaced the range")
    flat = _day(day, 0.05, 0.05, 0.05)
    if not near(c.frng_at(flat, day), 0.0):
        raise SystemExit("a flat funding day was not a zero range")
    if near(c.frng_at(flat, day), 0.05):
        raise SystemExit("the funding level replaced the range")
    missing = dict(funding)
    del missing[day + 2 * c.fp5.EIGHT_H_MS]
    if c.frng_at(missing, day) is not None:
        raise SystemExit("a day missing the 16:00 print was a print")
    extra = dict(funding)
    extra[day + c.fp5.DAY_MS // 24] = 0.0
    if c.frng_at(extra, day) is not None:
        raise SystemExit("a day with a fourth print was a print")
    later = c.fp5.SCREEN_END_MS
    if c.frng_at(_day(later, -0.01, 0.0, 0.01), later) is not None:
        raise SystemExit("a 2024 day was a print")
    if c.HOLD_DAYS != 10 or c.HOLD_DAYS == 1:
        raise SystemExit("the hold is not 10 days")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.001) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.01)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    funding: dict[int, float] = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        span = 0.0001 if i < 120 else 0.01
        funding.update(_day(day, 0.0, span / 2.0, span))
    last = start + 120 * c.fp5.DAY_MS
    if c.frng_signal_days(funding) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.HOLD_DAYS * c.fp5.DAY_MS
    bars = {
        entry: (100.0,),
        exit_: (101.0,),
    }
    filled = [t for t in c.frng_trades(funding, bars) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit("entry must be the next daily open")
    if filled[0]["exit_ms"] != exit_:
        raise SystemExit("the hold is not 10 days")
    if filled[0]["coin"] != "BTCUSDT":
        raise SystemExit("the fill is not BTC")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail_and_fill()
    print("fp109 pins ok")


if __name__ == "__main__":
    main()
