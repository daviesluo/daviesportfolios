"""Pins for the fp43 rule. No file and no return from 2023 is read."""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def qday(day: int, signed: list[int], quotes: list[float], extra: float | None = None) -> dict[int, tuple]:
    hours = {}
    for k, sign in enumerate(signed):
        close = 100.0 if sign == 0 else 100.0 * (1.0 + 0.01 * sign)
        bar = (100.0, close, quotes[k]) if extra is None else (100.0, close, quotes[k], extra)
        hours[day + k * c.HOUR_MS] = bar
    return hours


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    up = [1] * 24
    down = [-1] * 24
    if not near(c.upvol_at(qday(start, up, [1.0] * 24), start), 1.0):
        raise SystemExit("an all-up day did not put all volume in up hours")
    if not near(c.upvol_at(qday(start, down, [1.0] * 24), start), 0.0):
        raise SystemExit("an all-down day put volume in up hours")
    mixed_sign = [1] + [-1] * 23
    mixed_quote = [100.0] + [1.0] * 23
    if not near(c.upvol_at(qday(start, mixed_sign, mixed_quote), start), 100.0 / 123.0):
        raise SystemExit("one up hour did not keep its quote share")
    if abs(100.0 / 123.0 - 1.0 / 24.0) < 1e-9:
        raise SystemExit("the cousin fixture collapsed to the up-hour share")
    if not near(c.upvol_at(qday(start, up, [5.0] * 24), start), 1.0):
        raise SystemExit("scaling quote volume changed the share")
    flat = [0] * 24
    flat[0] = 1
    if not near(c.upvol_at(qday(start, flat, [1.0] * 24), start), 1.0 / 24.0):
        raise SystemExit("a flat hour was treated as an up hour")
    if not near(c.upvol_at(qday(start, up, [1.0] * 24, extra=9.0), start), 1.0):
        raise SystemExit("an extra field entered the share")
    short = qday(start, up, [1.0] * 24)
    del short[start + 4 * c.HOUR_MS]
    if c.upvol_at(short, start) is not None:
        raise SystemExit("a missing hour was a print")
    later = qday(c.fp5.SCREEN_END_MS, up, [1.0] * 24)
    if c.upvol_at(later, c.fp5.SCREEN_END_MS) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.upvol_at(later, c.fp5.SCREEN_END_MS, c.fp5.SCREEN_END_MS + c.fp5.DAY_MS), 1.0):
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

    hours: dict[int, tuple] = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        signed = [1] * 24 if i == 120 else [-1] * 24
        hours.update(qday(day, signed, [1.0] * 24))
    last = start + 120 * c.fp5.DAY_MS
    if c.upvol_signal_days(hours) != [last]:
        raise SystemExit("an up-volume day did not fire on its own")

    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}

    filled = [t for t in c.upvol_trades(daily, hours) if t["entry_ms"] == entry]
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
    print("fp43 pins ok")


if __name__ == "__main__":
    main()
