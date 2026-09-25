"""Pins for the fp30 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def day_from_signs(day: int, signs: list[int]) -> dict[int, tuple]:
    if len(signs) != c.HOURS:
        raise SystemExit("a day needs 24 hours")
    hours = {}
    for k, sign in enumerate(signs):
        close = 100.0 if sign == 0 else 100.0 * (1.0 + 0.01 * sign)
        hours[day + k * c.HOUR_MS] = (100.0, close)
    return hours


def book(start: int, n_days: int, last_signs: list[int]) -> dict[int, tuple]:
    hours: dict[int, tuple] = {}
    quiet = [1] * c.HOURS
    for i in range(n_days):
        signs = last_signs if i == n_days - 1 else quiet
        hours.update(day_from_signs(start + i * c.fp5.DAY_MS, signs))
    return hours


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    block = [1] * 12 + [-1] * 12
    alt = [1 if k % 2 == 0 else -1 for k in range(c.HOURS)]
    if c.turn_at(day_from_signs(start, block), start) != 1:
        raise SystemExit("twelve up hours then twelve down hours were not one turn")
    if c.turn_at(day_from_signs(start, alt), start) != 23:
        raise SystemExit("an alternating day was not 23 turns")
    if sum(1 for s in block if s > 0) != sum(1 for s in alt if s > 0):
        raise SystemExit("the cousin fixture did not keep the same up-hour count")
    flat = [1, 0, -1] + [1] * 21
    # + to − across the flat hour, then − back to +. The flat hour is not a turn.
    if c.turn_at(day_from_signs(start, flat), start) != 2:
        raise SystemExit("a flat hour erased the previous sign")
    scaled = {t: (b[0] * 4, b[1] * 4) for t, b in day_from_signs(start, alt).items()}
    if c.turn_at(scaled, start) != 23:
        raise SystemExit("scaling the path changed the turn count")
    short = day_from_signs(start, alt)
    del short[start + 3 * c.HOUR_MS]
    if c.turn_at(short, start) is not None:
        raise SystemExit("a missing hour was a print")
    later = day_from_signs(c.fp5.SCREEN_END_MS, alt)
    if c.turn_at(later, c.fp5.SCREEN_END_MS) is not None:
        raise SystemExit("a 2024 day was a print")
    if c.turn_at(later, c.fp5.SCREEN_END_MS, c.fp5.SCREEN_END_MS + c.fp5.DAY_MS) != 23:
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 1.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 2.0)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")
    points[-1] = (points[-1][0], 0.0)
    if c._upper(points, 0.90):
        raise SystemExit("a quiet day was returned")


def test_tail_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    alt = [1 if k % 2 == 0 else -1 for k in range(c.HOURS)]
    hours = book(start, 121, alt)
    last = start + 120 * c.fp5.DAY_MS
    if c.turn_signal_days(hours) != [last]:
        raise SystemExit("a choppy day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.turn_trades(daily, hours) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit("entry must be the next daily open")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail_and_fill()
    print("fp30 pins ok")


if __name__ == "__main__":
    main()
