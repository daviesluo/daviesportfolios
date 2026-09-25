"""Pins for the fp19 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp19/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(high: float, low: float, close: float, open_px: float = 100.0) -> tuple:
    return (open_px, high, low, close)


def book(start: int, n_days: int, last: tuple[float, float, float] | None) -> dict[int, tuple]:
    """Mid-range days, then an optional last bar as (high, low, close)."""
    daily = {}
    for i in range(n_days):
        if i == n_days - 1 and last is not None:
            high, low, close = last
        else:
            high, low, close = 110.0, 90.0, 100.0
        daily[start + i * c.fp5.DAY_MS] = _bar(high, low, close, open_px=close)
    return daily


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    if c.loc_at({start: _bar(110.0, 90.0, 110.0)}, start) != 1.0:
        raise SystemExit("a close on the high was not 1")
    if c.loc_at({start: _bar(110.0, 90.0, 90.0)}, start) != 0.0:
        raise SystemExit("a close on the low was not 0")
    if c.loc_at({start: _bar(110.0, 90.0, 100.0)}, start) != 0.5:
        raise SystemExit("a close in the middle was not 0.5")
    if c.loc_at({start: _bar(100.0, 100.0, 100.0)}, start) is not None:
        raise SystemExit("a flat bar was a print")
    if c.loc_at({start: _bar(90.0, 110.0, 100.0)}, start) is not None:
        raise SystemExit("a high under the low was a print")
    if c.loc_at({start: _bar(110.0, 90.0, 120.0)}, start) is not None:
        raise SystemExit("a close outside the range was a print")
    # Close 90 against a previous close of 100: the day is down, and it closed on its high.
    down = {start: _bar(90.0, 70.0, 90.0, open_px=80.0)}
    if not (90.0 < 100.0 and c.loc_at(down, start) == 1.0):
        raise SystemExit("a down day that closed on its high was not 1")
    up = {start: _bar(130.0, 105.0, 105.0, open_px=110.0)}
    if not (105.0 > 100.0 and c.loc_at(up, start) == 0.0):
        raise SystemExit("an up day that closed on its low was not 0")
    narrow = c.loc_at({start: _bar(101.0, 100.0, 101.0)}, start)
    wide = c.loc_at({start: _bar(200.0, 100.0, 200.0)}, start)
    if narrow != 1.0 or wide != 1.0:
        raise SystemExit("the range width moved a close that sat on the high")
    with_quote = {start: (90.0, 95.0, 80.0, 95.0, 1.0e12)}
    if c.loc_at(with_quote, start) != 1.0:
        raise SystemExit("a volume field moved the location")
    other_open = {start: _bar(90.0, 70.0, 90.0, open_px=70.0)}
    if c.loc_at(other_open, start) != c.loc_at(down, start):
        raise SystemExit("the open moved the location")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.5) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.51)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")
    points[-1] = (points[-1][0], 0.0)
    if c._upper(points, 0.90):
        raise SystemExit("the low location was returned")
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
    hot = book(start, 150, (95.0, 80.0, 95.0))
    last = start + 149 * c.fp5.DAY_MS
    if c.loc_signal_days(hot) != [last]:
        raise SystemExit("a close on the high did not fire on its own")
    cold = book(start, 150, (120.0, 105.0, 105.0))
    if c.loc_signal_days(cold):
        raise SystemExit("a close on the low was scored")
    wide_middle = book(start, 150, (200.0, 100.0, 150.0))
    if c.loc_signal_days(wide_middle):
        raise SystemExit("a wide range that closed in the middle fired")
    gapped = dict(hot)
    del gapped[last]
    if any(ts == last for ts, _ in c.loc_prints(gapped)):
        raise SystemExit("a missing day was scored")


def test_window_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    daily = book(start, 150, (95.0, 80.0, 95.0))
    signal = start + 149 * c.fp5.DAY_MS
    entry = signal + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    untouched = c.loc_at(daily, signal)
    daily[entry] = _bar(100.0, 100.0, 100.0, open_px=100.0)
    daily[exit_] = _bar(101.0, 101.0, 101.0, open_px=101.0)
    if c.loc_at(daily, signal) != untouched:
        raise SystemExit("a later day leaked into the signal")
    filled = [t for t in c.loc_trades(daily) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit(f"entry must be the next daily open: {filled}")
    if filled[0]["coin"] != "BTCUSDT":
        raise SystemExit("the coin is not BTCUSDT")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    del daily[exit_]
    if any(t["entry_ms"] == entry for t in c.loc_trades(daily)):
        raise SystemExit("a hold crossed a missing day")

    late_start = c.fp5.SCREEN_END_MS - 120 * c.fp5.DAY_MS
    late = book(late_start, 120, (95.0, 80.0, 95.0))
    boundary = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if boundary not in c.loc_signal_days(late):
        raise SystemExit("the last 2023 signal should be a candidate")
    if any(t["entry_ms"] >= c.fp5.SCREEN_END_MS for t in c.loc_trades(late)):
        raise SystemExit("an entry at 2024-01-01 was kept")
    after = dict(late)
    after[c.fp5.SCREEN_END_MS] = _bar(1.0e9, 1.0, 1.0e9)
    if any(ts >= c.fp5.SCREEN_END_MS for ts, _ in c.loc_prints(after)):
        raise SystemExit("a 2024 bar was a print")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail()
    test_window_and_fill()
    print("fp19 pins ok")


if __name__ == "__main__":
    main()
