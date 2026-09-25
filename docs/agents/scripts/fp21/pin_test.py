"""Pins for the fp21 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp21/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(close: float, base: float = 1.0, quote: float = 100.0, open_px: float = 100.0) -> tuple:
    return (open_px, close, base, quote)


def book(start: int, n_days: int, last_close: float | None) -> dict[int, tuple]:
    """Days whose close equals a VWAP of 100, then an optional last close."""
    daily = {}
    for i in range(n_days):
        close = 100.0 if i < n_days - 1 or last_close is None else last_close
        daily[start + i * c.fp5.DAY_MS] = _bar(close)
    return daily


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    above = {start: _bar(110.0, 2.0, 200.0)}
    got = c.prem_at(above, start)
    if got is None or abs(got - 0.10) > 1e-12:
        raise SystemExit(f"a close 10% over VWAP was not 0.10: {got}")
    scaled = {start: _bar(110.0, 8.0, 800.0, open_px=1.0)}
    if c.prem_at(scaled, start) != got:
        raise SystemExit("scaling volume, or the open, moved the premium")
    if c.prem_at({start: _bar(100.0, 5.0, 500.0)}, start) != 0.0:
        raise SystemExit("a close on the VWAP was not zero")
    richer = c.prem_at({start: _bar(110.0, 2.0, 400.0)}, start)
    if richer is None or not richer < got:
        raise SystemExit("a higher VWAP did not lower the premium")
    if c.prem_at({start: _bar(110.0, 0.0, 200.0)}, start) is not None:
        raise SystemExit("a day with no base volume was a print")
    if c.prem_at({start: _bar(110.0, 2.0, 0.0)}, start) is not None:
        raise SystemExit("a day with no quote volume was a print")
    if c.prem_at({start: (100.0, 110.0, 2.0, 200.0, 9.0)}, start) != got:
        raise SystemExit("a trade-count field moved the premium")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.01)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")
    points[-1] = (points[-1][0], -0.05)
    if c._upper(points, 0.90):
        raise SystemExit("a close under VWAP was returned")
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
    if c.prem_signal_days(hot) != [last]:
        raise SystemExit("a close above VWAP did not fire on its own")
    cold = book(start, 150, 90.0)
    if c.prem_signal_days(cold):
        raise SystemExit("a close under VWAP was scored")
    loud = book(start, 150, None)
    loud[last] = _bar(100.0, 1.0e6, 1.0e8)
    if c.prem_signal_days(loud):
        raise SystemExit("a large volume at the VWAP fired")
    gapped = dict(hot)
    del gapped[last]
    if any(ts == last for ts, _ in c.prem_prints(gapped)):
        raise SystemExit("a missing day was scored")


def test_window_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    daily = book(start, 150, 110.0)
    signal = start + 149 * c.fp5.DAY_MS
    entry = signal + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    untouched = c.prem_at(daily, signal)
    daily[entry] = _bar(100.0, open_px=100.0)
    daily[exit_] = _bar(101.0, open_px=101.0)
    if c.prem_at(daily, signal) != untouched:
        raise SystemExit("a later day leaked into the signal")
    filled = [t for t in c.prem_trades(daily) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit(f"entry must be the next daily open: {filled}")
    if any(t["entry_ms"] == signal for t in c.prem_trades(daily)):
        raise SystemExit("the signal day's open was the entry")
    if filled[0]["coin"] != "BTCUSDT":
        raise SystemExit("the coin is not BTCUSDT")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    del daily[exit_]
    if any(t["entry_ms"] == entry for t in c.prem_trades(daily)):
        raise SystemExit("a hold crossed a missing day")

    late_start = c.fp5.SCREEN_END_MS - 120 * c.fp5.DAY_MS
    late = book(late_start, 120, 110.0)
    boundary = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if boundary not in c.prem_signal_days(late):
        raise SystemExit("the last 2023 signal should be a candidate")
    if any(t["entry_ms"] >= c.fp5.SCREEN_END_MS for t in c.prem_trades(late)):
        raise SystemExit("an entry at 2024-01-01 was kept")
    after = dict(late)
    after[c.fp5.SCREEN_END_MS] = _bar(1.0e9)
    if any(ts >= c.fp5.SCREEN_END_MS for ts, _ in c.prem_prints(after)):
        raise SystemExit("a 2024 bar was a print")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail()
    test_window_and_fill()
    print("fp21 pins ok")


if __name__ == "__main__":
    main()
