"""Pins for the fp20 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp20/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def book(start: int, n_days: int, last_open: float | None) -> dict[int, tuple]:
    """Flat days, open equal to the previous close. An optional last open sets that day's gap."""
    daily = {}
    for i in range(n_days):
        open_ = 100.0
        if i == n_days - 1 and last_open is not None:
            open_ = last_open
        daily[start + i * c.fp5.DAY_MS] = (open_, 100.0)
    return daily


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    prev = start - c.fp5.DAY_MS
    daily = {prev: (100.0, 100.0), start: (110.0, 100.0)}
    gap = c.gap_at(daily, start)
    if gap is None or abs(gap - 0.10) > 1e-12:
        raise SystemExit(f"a 10% higher open was not a 10% gap: {gap}")
    # The close gave the gap back. The close-to-close return is zero.
    if daily[start][1] / daily[prev][1] - 1.0 != 0.0:
        raise SystemExit("the fixture's close-to-close return was not zero")
    flat = {prev: (100.0, 100.0), start: (100.0, 130.0)}
    if c.gap_at(flat, start) != 0.0:
        raise SystemExit("an unchanged open was not a zero gap")
    if flat[start][1] / flat[prev][1] - 1.0 <= 0.0:
        raise SystemExit("the unchanged-open fixture did not rally into the close")
    changed_close = {prev: (100.0, 100.0), start: (110.0, 50.0)}
    if c.gap_at(changed_close, start) != gap:
        raise SystemExit("the signal day's close moved the gap")
    with_extra = {prev: (100.0, 100.0, 1.0), start: (110.0, 100.0, 1.0e9)}
    if c.gap_at(with_extra, start) != gap:
        raise SystemExit("an extra field moved the gap")
    if c.gap_at({start: (110.0, 100.0)}, start) is not None:
        raise SystemExit("a missing previous close was a print")
    if c.gap_at({prev: (100.0, 0.0), start: (110.0, 100.0)}, start) is not None:
        raise SystemExit("a zero previous close was a print")
    hole = {prev - c.fp5.DAY_MS: (100.0, 100.0), start: (110.0, 100.0)}
    if c.gap_at(hole, start) is not None:
        raise SystemExit("a hole in the grid was a print")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.01)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")
    points[-1] = (points[-1][0], -0.05)
    if c._upper(points, 0.90):
        raise SystemExit("the gap down was returned")
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
    hot = book(start, 150, 110.0)
    last = start + 149 * c.fp5.DAY_MS
    if c.gap_signal_days(hot) != [last]:
        raise SystemExit("a gap up did not fire on its own")
    if last - c.fp5.DAY_MS in c.gap_signal_days(hot):
        raise SystemExit("the signal was read a day early")
    cold = book(start, 150, 90.0)
    if c.gap_signal_days(cold):
        raise SystemExit("a gap down was scored")
    unchanged = book(start, 150, None)
    if c.gap_signal_days(unchanged):
        raise SystemExit("a zero gap fired")
    gapped = dict(hot)
    del gapped[last - c.fp5.DAY_MS]
    if c.gap_at(gapped, last) is not None:
        raise SystemExit("a missing previous day was scored")


def test_window_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    daily = book(start, 150, 110.0)
    signal = start + 149 * c.fp5.DAY_MS
    entry = signal + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    untouched = c.gap_at(daily, signal)
    daily[entry] = (100.0, 100.0)
    daily[exit_] = (101.0, 101.0)
    if c.gap_at(daily, signal) != untouched:
        raise SystemExit("a later day leaked into the signal")
    filled = [t for t in c.gap_trades(daily) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit(f"entry must be the open after the gap: {filled}")
    if any(t["entry_ms"] == signal for t in c.gap_trades(daily)):
        raise SystemExit("the open the gap was read from was the entry")
    if filled[0]["coin"] != "BTCUSDT":
        raise SystemExit("the coin is not BTCUSDT")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    del daily[exit_]
    if any(t["entry_ms"] == entry for t in c.gap_trades(daily)):
        raise SystemExit("a hold crossed a missing day")

    late_start = c.fp5.SCREEN_END_MS - 120 * c.fp5.DAY_MS
    late = book(late_start, 120, 110.0)
    boundary = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if boundary not in c.gap_signal_days(late):
        raise SystemExit("the last 2023 signal should be a candidate")
    if any(t["entry_ms"] >= c.fp5.SCREEN_END_MS for t in c.gap_trades(late)):
        raise SystemExit("an entry at 2024-01-01 was kept")
    after = dict(late)
    after[c.fp5.SCREEN_END_MS] = (1.0e9, 1.0e9)
    if any(ts >= c.fp5.SCREEN_END_MS for ts, _ in c.gap_prints(after)):
        raise SystemExit("a 2024 bar was a print")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail()
    test_window_and_fill()
    print("fp20 pins ok")


if __name__ == "__main__":
    main()
