"""Pins for the fp65 rule. No file and no return from 2023 is read."""

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
    # (open, high, low). BTC is wide, ETH is tight. The close is not stored.
    btc = {day: (100.0, 110.0, 100.0)}
    eth = {day: (100.0, 101.0, 100.0)}
    if not near(c.span_at(btc, eth, day), 0.1):
        raise SystemExit("ETH's range over BTC's range was wrong")
    wide_eth = {day: (100.0, 105.0, 100.0)}
    quiet_btc = {day: (100.0, 100.1, 100.0)}
    if not near(c.span_at(quiet_btc, wide_eth, day), 0.05 / 0.001):
        raise SystemExit("a quiet BTC day with a wide ETH day did not rank high")
    if c.span_at({day: (100.0, 100.0, 100.0)}, eth, day) is not None:
        raise SystemExit("a zero BTC range was a print")
    if c.span_at(btc, {day: (100.0, 100.0, 100.0)}, day) is not None:
        raise SystemExit("a zero ETH range was a print")
    later = c.fp5.SCREEN_END_MS
    if c.span_at({later: (100.0, 110.0, 100.0)}, {later: (100.0, 101.0, 100.0)}, later) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(
        c.span_at(
            {later: (100.0, 110.0, 100.0)},
            {later: (100.0, 101.0, 100.0)},
            later,
            later + c.fp5.DAY_MS,
        ),
        0.1,
    ):
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
    btc = {}
    eth = {}
    for i in range(121):
        day = start + i * c.fp5.DAY_MS
        btc[day] = (100.0, 110.0, 100.0)
        if i < 120:
            eth[day] = (100.0, 101.0, 100.0)
        else:
            eth[day] = (100.0, 150.0, 100.0)
    last = start + 120 * c.fp5.DAY_MS
    if c.span_signal_days(btc, eth) != [last]:
        raise SystemExit("the extreme day did not fire on its own")
    entry = last + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    book = dict(btc)
    book[entry] = (100.0, 110.0, 100.0)
    book[exit_] = (101.0, 110.0, 100.0)
    filled = [t for t in c.span_trades(book, eth) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit("entry must be the next BTC open")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail_and_fill()
    print("fp65 pins ok")


if __name__ == "__main__":
    main()
