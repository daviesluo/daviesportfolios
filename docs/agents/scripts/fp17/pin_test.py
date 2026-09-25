"""Pins for the fp17 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp17/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(quote: float, count: float, open_px: float = 100.0) -> tuple:
    return (open_px, open_px, open_px, open_px, quote, count)


def book(start: int, n_days: int, quote: float, count: float, last: tuple[float, float] | None) -> dict[int, tuple]:
    daily = {}
    for i in range(n_days):
        q, n = (quote, count) if i < n_days - 1 or last is None else last
        daily[start + i * c.fp5.DAY_MS] = _bar(q, n)
    return daily


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    daily = {start: _bar(1000.0, 10.0)}
    if c.size_at(daily, start) != 100.0:
        raise SystemExit("size is not quote divided by count")
    scaled = {start: _bar(2000.0, 20.0)}
    if c.size_at(scaled, start) != c.size_at(daily, start):
        raise SystemExit("scaling volume and count together moved the size")
    louder = {start: _bar(2000.0, 10.0)}
    if c.size_at(louder, start) != 200.0:
        raise SystemExit("quote volume alone was not the numerator")
    if c.size_at({start: _bar(1000.0, 0.0)}, start) is not None:
        raise SystemExit("a day with no trades was a print")
    if c.size_at({start: _bar(0.0, 10.0)}, start) is not None:
        raise SystemExit("a day with no quote volume was a print")
    wicked = {start: (100.0, 1e9, 1e-9, 50.0, 1000.0, 10.0)}
    if c.size_at(wicked, start) != 100.0:
        raise SystemExit("high, low or close moved the size")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 1.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 1.01)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")
    points[-1] = (points[-1][0], 0.5)
    if c._upper(points, 0.90):
        raise SystemExit("the small-trade tail was returned")
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
    hot = book(start, 150, 100.0, 100.0, (1000.0, 100.0))
    last = start + 149 * c.fp5.DAY_MS
    if c.size_signal_days(hot) != [last]:
        raise SystemExit("a day of large prints did not fire on its own")
    cold = book(start, 150, 1000.0, 100.0, (100.0, 100.0))
    if c.size_signal_days(cold):
        raise SystemExit("the small-trade tail was scored")
    gapped = dict(hot)
    del gapped[last]
    if any(ts == last for ts, _ in c.size_prints(gapped)):
        raise SystemExit("a missing day was scored")


def test_window_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    daily = book(start, 150, 100.0, 100.0, (1000.0, 100.0))
    signal = start + 149 * c.fp5.DAY_MS
    entry = signal + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    untouched = c.size_at(daily, signal)
    daily[entry] = _bar(100.0, 100.0, open_px=100.0)
    daily[exit_] = _bar(100.0, 100.0, open_px=101.0)
    if c.size_at(daily, signal) != untouched:
        raise SystemExit("a later day leaked into the signal")
    filled = [t for t in c.size_trades(daily) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit(f"entry must be the next daily open: {filled}")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    del daily[exit_]
    if any(t["entry_ms"] == entry for t in c.size_trades(daily)):
        raise SystemExit("a hold crossed a missing day")

    late_start = c.fp5.SCREEN_END_MS - 120 * c.fp5.DAY_MS
    late = book(late_start, 120, 100.0, 100.0, (1000.0, 100.0))
    boundary = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if boundary not in c.size_signal_days(late):
        raise SystemExit("the last 2023 signal should be a candidate")
    if any(t["entry_ms"] >= c.fp5.SCREEN_END_MS for t in c.size_trades(late)):
        raise SystemExit("an entry at 2024-01-01 was kept")
    after = dict(late)
    after[c.fp5.SCREEN_END_MS] = _bar(1e9, 1.0)
    if any(ts >= c.fp5.SCREEN_END_MS for ts, _ in c.size_prints(after)):
        raise SystemExit("a 2024 bar was a print")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail()
    test_window_and_fill()
    print("fp17 pins ok")


if __name__ == "__main__":
    main()
