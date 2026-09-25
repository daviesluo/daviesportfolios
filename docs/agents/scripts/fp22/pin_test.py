"""Pins for the fp22 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp22/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def day_hours(day: int, quotes: list[float]) -> dict[int, tuple]:
    if len(quotes) != c.HOURS:
        raise SystemExit("a day fixture needs 24 hours")
    return {day + k * c.HOUR_MS: (quote,) for k, quote in enumerate(quotes)}


def book(start: int, n_days: int, last: list[float] | None) -> dict[int, tuple]:
    """Even days, then an optional last day's 24 quote volumes."""
    hours: dict[int, tuple] = {}
    even = [1.0] * c.HOURS
    for i in range(n_days):
        quotes = last if i == n_days - 1 and last is not None else even
        hours.update(day_hours(start + i * c.fp5.DAY_MS, quotes))
    return hours


def spike(hour: int) -> list[float]:
    quotes = [0.0] * c.HOURS
    quotes[hour] = 1.0
    return quotes


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    even = c.hhi_at(day_hours(start, [1.0] * 24), start)
    if even is None or abs(even - 1.0 / 24.0) > 1e-12:
        raise SystemExit(f"an even day was not 1/24: {even}")
    scaled = c.hhi_at(day_hours(start, [10.0] * 24), start)
    if scaled != even:
        raise SystemExit("scaling every hour moved the Herfindahl")
    at_open = c.hhi_at(day_hours(start, spike(0)), start)
    at_close = c.hhi_at(day_hours(start, spike(17)), start)
    if at_open != 1.0 or at_close != 1.0:
        raise SystemExit("a one-hour day was not 1, or the clock hour mattered")
    half = [0.0] * 24
    half[3] = 1.0
    half[9] = 1.0
    got = c.hhi_at(day_hours(start, half), start)
    if got is None or abs(got - 0.5) > 1e-12:
        raise SystemExit(f"two equal hours were not 0.5: {got}")
    with_price = {start + k * c.HOUR_MS: (1.0, 99_000.0) for k in range(24)}
    if c.hhi_at(with_price, start) != even:
        raise SystemExit("a price field moved the Herfindahl")
    if c.hhi_at(day_hours(start, [0.0] * 24), start) is not None:
        raise SystemExit("a day with no volume was a print")
    negative = [1.0] * 24
    negative[2] = -1.0
    if c.hhi_at(day_hours(start, negative), start) is not None:
        raise SystemExit("a negative quote was a print")
    short = day_hours(start, [1.0] * 24)
    del short[start + 5 * c.HOUR_MS]
    if c.hhi_at(short, start) is not None:
        raise SystemExit("a missing hour was a print")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 1.0 / 24.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 1.0 / 24.0 + 0.01)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")
    points[-1] = (points[-1][0], 1.0 / 24.0 - 0.01)
    if c._upper(points, 0.90):
        raise SystemExit("an even day was returned")
    ladder = [(i * c.fp5.DAY_MS, float(i)) for i in range(91)]
    last = ladder[-1][0]
    ladder[-1] = (last, 80.0)
    if c._upper(ladder, 0.90):
        raise SystemExit("a value equal to the 90th of a ladder fired")
    ladder[-1] = (last, 75.0)
    if last not in c._upper(ladder, 0.80):
        raise SystemExit("75 did not clear the 80th neighbour")
    if c._upper(ladder, 0.90):
        raise SystemExit("the 80th neighbour was treated as the screen cut")


def test_tail() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hot = book(start, 150, spike(23))
    last = start + 149 * c.fp5.DAY_MS
    if c.hhi_signal_days(hot) != [last]:
        raise SystemExit("a concentrated day did not fire on its own")
    cold = book(start, 150, None)
    # History of concentrated days, then an even day.
    for i in range(149):
        day = start + i * c.fp5.DAY_MS
        cold.update(day_hours(day, spike(i % 24)))
    if c.hhi_signal_days(cold):
        raise SystemExit("an even day was scored")
    gapped = dict(hot)
    del gapped[last + 4 * c.HOUR_MS]
    if any(ts == last for ts, _ in c.hhi_prints(gapped)):
        raise SystemExit("a day with a missing hour was scored")


def test_window_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = book(start, 150, spike(0))
    signal = start + 149 * c.fp5.DAY_MS
    entry = signal + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    untouched = c.hhi_at(hours, signal)
    daily[entry] = (50.0,)
    daily[exit_] = (200.0,)
    if c.hhi_at(hours, signal) != untouched:
        raise SystemExit("the daily open leaked into the signal")
    daily[entry] = (100.0,)
    daily[exit_] = (101.0,)
    filled = [t for t in c.hhi_trades(daily, hours) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit(f"entry must be the next daily open: {filled}")
    if any(t["entry_ms"] == signal for t in c.hhi_trades(daily, hours)):
        raise SystemExit("the signal day was the entry")
    if filled[0]["coin"] != "BTCUSDT":
        raise SystemExit("the coin is not BTCUSDT")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    del daily[exit_]
    if any(t["entry_ms"] == entry for t in c.hhi_trades(daily, hours)):
        raise SystemExit("a hold crossed a missing day")

    late_start = c.fp5.SCREEN_END_MS - 120 * c.fp5.DAY_MS
    late = book(late_start, 120, spike(23))
    boundary = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if boundary not in c.hhi_signal_days(late):
        raise SystemExit("the last 2023 signal should be a candidate")
    late_daily = {c.fp5.SCREEN_END_MS: (100.0,), c.fp5.SCREEN_END_MS + c.fp5.DAY_MS: (101.0,)}
    if any(t["entry_ms"] >= c.fp5.SCREEN_END_MS for t in c.hhi_trades(late_daily, late)):
        raise SystemExit("an entry at 2024-01-01 was kept")
    after = dict(late)
    after[c.fp5.SCREEN_END_MS] = (1.0e12,)
    if any(ts >= c.fp5.SCREEN_END_MS for ts, _ in c.hhi_prints(after)):
        raise SystemExit("a 2024 day was a print")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail()
    test_window_and_fill()
    print("fp22 pins ok")


if __name__ == "__main__":
    main()
