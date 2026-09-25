"""Pins for the fp9 rules. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp9/pin_test.py
"""

from __future__ import annotations

import math
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(close: float, open_px: float | None = None) -> tuple:
    px = close if open_px is None else open_px
    return (px, px, px, close, 1.0)


def _flat_daily(start: int, n: int, close: float = 100.0) -> dict[int, tuple]:
    return {start + i * c.fp5.DAY_MS: _bar(close) for i in range(n)}


def test_realized_is_sample_vol_in_points() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    daily = _flat_daily(start, 40, 100.0)
    day = start + 39 * c.fp5.DAY_MS
    daily[day] = _bar(100.0 * math.exp(math.log(1.01)))
    returns = [0.0] * 29 + [math.log(1.01)]
    mean = sum(returns) / 30.0
    var = sum((r - mean) ** 2 for r in returns) / 29.0
    expected = math.sqrt(var) * math.sqrt(365.0) * 100.0
    got = c._realized_points(daily, day)
    if got is None or abs(got - expected) > 1e-9:
        raise SystemExit(f"realized points: got {got} expected {expected}")
    # A constant daily doubling has sample vol zero, so the gap is the DVOL print.
    doubled = {}
    for i in range(40):
        doubled[start + i * c.fp5.DAY_MS] = _bar(100.0 * (2.0 ** i))
    if c._realized_points(doubled, day) != 0.0:
        raise SystemExit("constant log returns must have zero sample vol")
    points = c.vrp_points(doubled, [(day, 40.0)])
    if points != [(day, 40.0)]:
        raise SystemExit(f"gap must be DVOL when realized is zero: {points}")


def test_vrp_tail_and_holes() -> None:
    start = c.fp5.SCREEN_START_MS - 200 * c.fp5.DAY_MS
    daily = _flat_daily(start, 160, 100.0)
    days = [start + i * c.fp5.DAY_MS for i in range(30, 130)]
    dvol = [(d, 10.0) for d in days]
    if days[-1] in c.vrp_signal_days(daily, dvol):
        raise SystemExit("a gap equal to the trailing 90th must not fire")
    dvol[-1] = (days[-1], 11.0)
    if days[-1] not in c.vrp_signal_days(daily, dvol):
        raise SystemExit("a gap above the trailing 90th must fire")
    dvol[-1] = (days[-1], 0.0)
    if days[-1] in c.vrp_signal_days(daily, dvol):
        raise SystemExit("the low tail was scored")
    hole = days[-1] - 5 * c.fp5.DAY_MS
    broken = dict(daily)
    del broken[hole]
    dvol[-1] = (days[-1], 11.0)
    if any(ts == days[-1] for ts, _ in c.vrp_points(broken, dvol)):
        raise SystemExit("a hole inside the 30-day window was filled in")
    dead = dict(daily)
    dead[days[-1]] = _bar(0.0)
    if any(ts == days[-1] for ts, _ in c.vrp_points(dead, dvol)):
        raise SystemExit("a non-positive close was scored")


def test_vrp_window_is_ninety_days() -> None:
    start = c.fp5.SCREEN_START_MS - 500 * c.fp5.DAY_MS
    daily = _flat_daily(start, 400, 100.0)
    ancient = [start + i * c.fp5.DAY_MS for i in range(30, 120)]
    recent = [start + i * c.fp5.DAY_MS for i in range(300, 310)]
    spike = start + 310 * c.fp5.DAY_MS
    dvol = [(d, 0.0) for d in ancient + recent] + [(spike, 50.0)]
    if spike in c.vrp_signal_days(daily, dvol):
        raise SystemExit("points older than 90 days were counted toward the 90")
    contiguous = [start + i * c.fp5.DAY_MS for i in range(30, 121)]
    rich = [(d, 0.0) for d in contiguous[:-1]] + [(contiguous[-1], 50.0)]
    if contiguous[-1] not in c.vrp_signal_days(daily, rich):
        raise SystemExit("ninety recent days must be enough history")


def test_vrp_does_not_enter_on_the_signal_day_or_in_2024() -> None:
    start = c.fp5.SCREEN_END_MS - 130 * c.fp5.DAY_MS
    daily = _flat_daily(start, 140, 100.0)
    signal = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    days = [signal - i * c.fp5.DAY_MS for i in range(90, -1, -1)]
    dvol = [(d, 10.0) for d in days[:-1]] + [(signal, 20.0)]
    if signal not in c.vrp_signal_days(daily, dvol):
        raise SystemExit("the 2023-12-31 gap should be a signal")
    trades = c.vrp_trades(daily, dvol)
    if trades:
        raise SystemExit("the next open is 2024-01-01 and must not be an entry")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    entry = c.fp5.SCREEN_START_MS
    signal = entry - c.fp5.DAY_MS
    probe_daily = _flat_daily(signal - 130 * c.fp5.DAY_MS, 140, 100.0)
    probe_daily[entry] = _bar(100.0)
    probe_daily[entry + c.fp5.DAY_MS] = _bar(101.0)
    probe_days = [signal - i * c.fp5.DAY_MS for i in range(90, -1, -1)]
    probe_dvol = [(d, 10.0) for d in probe_days[:-1]] + [(signal, 20.0)]
    filled = c.vrp_trades(probe_daily, probe_dvol)
    if len(filled) != 1 or filled[0]["entry_ms"] != entry:
        raise SystemExit("entry must be the open after the signal day")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-9:
        raise SystemExit("the fill is not fp5's")


def _eight(start: int, n: int, closes: dict[str, list[float]]) -> dict[str, dict[int, tuple]]:
    books: dict[str, dict[int, tuple]] = {}
    for coin, series in closes.items():
        book = {}
        for i, close in enumerate(series):
            book[start + i * c.fp5.EIGHT_H_MS] = _bar(close)
        books[coin] = book
    return books


def test_dispersion_is_population_and_needs_ten_basket_coins() -> None:
    start = c.fp5.SCREEN_START_MS
    coins = list(c.fp5.BASKET[:10])
    closes = {coin: [100.0, 100.0] for coin in coins}
    closes[coins[0]] = [100.0, 110.0]
    prints = c.dispersion_prints(_eight(start, 2, closes))
    # The first bar has no previous close. The print is the second bar, known 8h later.
    knowledge = start + 2 * c.fp5.EIGHT_H_MS
    if len(prints) != 1 or prints[0][0] != knowledge:
        raise SystemExit(f"the print must be stamped at t+8h: {prints}")
    # Nine zeros and one +0.10. Population stdev is 0.03; the sample one is not.
    if abs(prints[0][1] - 0.03) > 1e-12:
        raise SystemExit(f"population stdev: got {prints[0][1]}")
    short = dict(_eight(start, 2, closes))
    del short[coins[-1]]
    outsider = {**short, "ZZZUSDT": {start: _bar(100.0), knowledge: _bar(200.0)}}
    if c.dispersion_prints(outsider):
        raise SystemExit("a coin outside the basket counted toward the ten")
    if c.dispersion_prints(short):
        raise SystemExit("nine coins produced a print")


def test_dispersion_tail_timing_and_window() -> None:
    coins = list(c.fp5.BASKET[:10])
    entry = c.fp5.SCREEN_START_MS + 5 * c.fp5.DAY_MS
    wide_at = 96
    start = entry - (wide_at + 1) * c.fp5.EIGHT_H_MS
    n_bars = wide_at + 3
    closes = {coin: [100.0] * n_bars for coin in coins}
    closes[coins[0]][wide_at] = 120.0
    books = _eight(start, n_bars, closes)
    if entry not in c.dispersion_entries(books):
        raise SystemExit("a wider print must fire")
    trades = c.dispersion_trades(books)
    if [t["entry_ms"] for t in trades] != [entry]:
        raise SystemExit("entry must be the print time, one 8h hold")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] != c.fp5.EIGHT_H_MS:
        raise SystemExit("the hold is not one 8h bar")
    # The same width as the history must not fire. Powers of two keep the return exact.
    level = {coin: [1.0] * n_bars for coin in coins}
    for i in range(n_bars):
        level[coins[0]][i] = 2.0 ** i
    if c.dispersion_entries(_eight(start, n_bars, level)):
        raise SystemExit("a print equal to the trailing 90th must not fire")
    # History older than 90 days does not fill the count.
    old = {coin: [100.0] * 10 for coin in coins}
    old[coins[0]][9] = 150.0
    ancient = _eight(start - 200 * c.fp5.DAY_MS, 10, old)
    recent = _eight(start, 10, {coin: [100.0] * 10 for coin in coins})
    recent[coins[0]][9] = 150.0
    merged: dict[str, dict[int, tuple]] = {}
    for coin in coins:
        merged[coin] = {**ancient[coin], **recent[coin]}
    spike_time = start + 9 * c.fp5.EIGHT_H_MS + c.fp5.EIGHT_H_MS
    if spike_time in c.dispersion_entries(merged):
        raise SystemExit("prints older than 90 days were counted")


def test_dispersion_refuses_a_2024_entry() -> None:
    coins = list(c.fp5.BASKET[:10])
    # The bar that opens 8h before the screen end is known at 2024-01-01.
    t = c.fp5.SCREEN_END_MS - c.fp5.EIGHT_H_MS
    n_bars = 97
    start = t - (n_bars - 1) * c.fp5.EIGHT_H_MS
    closes = {coin: [100.0] * n_bars for coin in coins}
    closes[coins[0]][-1] = 130.0
    books = _eight(start, n_bars, closes)
    if c.fp5.SCREEN_END_MS not in c.dispersion_entries(books):
        raise SystemExit("the boundary print should be an entry candidate")
    if c.dispersion_trades(books):
        raise SystemExit("an entry at 2024-01-01 was kept")


def main() -> None:
    test_realized_is_sample_vol_in_points()
    test_vrp_tail_and_holes()
    test_vrp_window_is_ninety_days()
    test_vrp_does_not_enter_on_the_signal_day_or_in_2024()
    test_dispersion_is_population_and_needs_ten_basket_coins()
    test_dispersion_tail_timing_and_window()
    test_dispersion_refuses_a_2024_entry()
    print("fp9 pins ok")


if __name__ == "__main__":
    main()
