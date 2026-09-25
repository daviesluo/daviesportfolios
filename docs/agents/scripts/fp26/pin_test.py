"""Pins for the fp26 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp26/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def bar(open_: float, high: float, low: float, close: float) -> tuple:
    return (open_, high, low, close)


def with_body(body: float) -> tuple:
    """A bar whose body share is `body`. The low is 100 and the range is 100."""
    if not 0.0 <= body <= 1.0:
        raise SystemExit("a body share sits in [0, 1]")
    return bar(100.0, 200.0, 100.0, 100.0 + 100.0 * body)


def book(last: float, n_hist: int = 90) -> dict[int, tuple]:
    start = c.fp5.SCREEN_START_MS - n_hist * c.fp5.DAY_MS
    daily = {start + i * c.fp5.DAY_MS: with_body(0.5) for i in range(n_hist)}
    daily[start + n_hist * c.fp5.DAY_MS] = with_body(last)
    return daily


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    up = {start: bar(100.0, 110.0, 100.0, 110.0)}
    down = {start: bar(110.0, 110.0, 100.0, 100.0)}
    if c.body_at(up, start) != 1.0 or c.body_at(down, start) != 1.0:
        raise SystemExit("a full-range day was not body 1")
    if c.body_at(down, start) == (100.0 - 100.0) / (110.0 - 100.0):
        raise SystemExit("the down day was scored as close location")
    doji = {start: bar(100.0, 110.0, 90.0, 100.0)}
    if c.body_at(doji, start) != 0.0:
        raise SystemExit("a doji was not body 0")
    wide = {start: bar(100.0, 1000.0, 1.0, 100.0)}
    if c.body_at(wide, start) != 0.0:
        raise SystemExit("a wide doji was scored as a large body")
    # Same close location, different body. Both close on the high.
    small = {start: bar(108.0, 110.0, 90.0, 110.0)}
    half = {start: bar(100.0, 110.0, 90.0, 110.0)}
    if c.body_at(small, start) != 0.1 or c.body_at(half, start) != 0.5:
        raise SystemExit("close location was used in place of the body")
    scaled = {start: tuple(x * 3.0 for x in half[start])}
    if c.body_at(scaled, start) != c.body_at(half, start):
        raise SystemExit("scaling the bar moved the body")
    quoted = {start: half[start] + (1.0e9,)}
    if c.body_at(quoted, start) != 0.5:
        raise SystemExit("a volume field moved the body")
    if c.body_at({start: bar(100.0, 100.0, 100.0, 100.0)}, start) is not None:
        raise SystemExit("a flat bar was a print")
    if c.body_at({start: bar(100.0, 110.0, 90.0, 120.0)}, start) is not None:
        raise SystemExit("a close outside the range was a print")
    if c.body_at({start: bar(0.0, 110.0, 90.0, 100.0)}, start) is not None:
        raise SystemExit("a zero open was a print")
    if c.body_at({}, start) is not None:
        raise SystemExit("a missing bar was a print")
    later = {c.fp5.SCREEN_END_MS: bar(100.0, 110.0, 100.0, 110.0)}
    if c.body_at(later, c.fp5.SCREEN_END_MS) is not None:
        raise SystemExit("a 2024 bar was a print")
    if c.body_at(later, c.fp5.SCREEN_END_MS, c.fp5.SCREEN_END_MS + c.fp5.DAY_MS) != 1.0:
        raise SystemExit("a later horizon still dropped the 2024 bar")


def test_strict_quantile() -> None:
    tied = book(0.5)
    if c.body_signal_days(tied):
        raise SystemExit("a body equal to its own 90th fired")
    hot = book(0.51)
    last = max(hot)
    if last not in c.body_signal_days(hot):
        raise SystemExit("a larger body did not fire")
    if c.body_signal_days(book(1.0, n_hist=89)):
        raise SystemExit("89 prints were enough")
    if c.body_signal_days(book(0.0)):
        raise SystemExit("a doji was returned")
    start = c.fp5.SCREEN_START_MS - 90 * c.fp5.DAY_MS
    daily = {start + i * c.fp5.DAY_MS: with_body(0.2) for i in range(80)}
    daily.update({start + i * c.fp5.DAY_MS: with_body(0.8) for i in range(80, 90)})
    day = start + 90 * c.fp5.DAY_MS
    mid = dict(daily)
    mid[day] = with_body(0.5)
    if day in c.body_signal_days(mid):
        raise SystemExit("the 80th neighbour was treated as the screen cut")
    if day not in c.body_signal_days(mid, q=0.80):
        raise SystemExit("0.5 did not clear the 80th neighbour")
    exact = dict(daily)
    exact[day] = with_body(0.8)
    if day in c.body_signal_days(exact):
        raise SystemExit("a body equal to the split book's 90th fired")
    over = dict(daily)
    over[day] = with_body(0.81)
    if day not in c.body_signal_days(over):
        raise SystemExit("a body above the split book's 90th did not fire")


def test_sign_does_not_matter() -> None:
    start = c.fp5.SCREEN_START_MS - 90 * c.fp5.DAY_MS
    daily = {start + i * c.fp5.DAY_MS: with_body(0.5) for i in range(90)}
    day = start + 90 * c.fp5.DAY_MS
    up = dict(daily)
    up[day] = bar(100.0, 110.0, 100.0, 110.0)
    down = dict(daily)
    down[day] = bar(110.0, 110.0, 100.0, 100.0)
    if c.body_signal_days(up) != [day] or c.body_signal_days(down) != [day]:
        raise SystemExit("the sign of the day changed the signal")


def test_window_and_fill() -> None:
    daily = book(1.0)
    signal = max(daily)
    entry = signal + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily[entry] = bar(100.0, 100.0, 100.0, 100.0)
    daily[exit_] = bar(101.0, 101.0, 101.0, 101.0)
    if not (c.fp5.SCREEN_START_MS <= entry < c.fp5.SCREEN_END_MS):
        raise SystemExit("the fixture's entry is outside 2023")
    filled = [t for t in c.body_trades(daily) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit(f"entry must be the next daily open: {filled}")
    if any(t["entry_ms"] == signal for t in c.body_trades(daily)):
        raise SystemExit("the signal day was the entry")
    if filled[0]["coin"] != "BTCUSDT":
        raise SystemExit("the coin is not BTCUSDT")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    leaked = dict(daily)
    leaked[exit_] = bar(101.0, 500.0, 1.0, 50.0)
    again = [t for t in c.body_trades(leaked) if t["entry_ms"] == entry]
    if len(again) != 1 or abs(again[0]["net"] - filled[0]["net"]) > 1e-12:
        raise SystemExit("the exit bar's range leaked into the fill")
    del daily[exit_]
    if any(t["entry_ms"] == entry for t in c.body_trades(daily)):
        raise SystemExit("a hold crossed a missing day")

    boundary = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    late = {boundary - (90 - i) * c.fp5.DAY_MS: with_body(0.5) for i in range(90)}
    late[boundary] = with_body(1.0)
    if boundary not in c.body_signal_days(late):
        raise SystemExit("the last 2023 signal should be a candidate")
    late[c.fp5.SCREEN_END_MS] = bar(100.0, 100.0, 100.0, 100.0)
    late[c.fp5.SCREEN_END_MS + c.fp5.DAY_MS] = bar(101.0, 101.0, 101.0, 101.0)
    if any(t["entry_ms"] >= c.fp5.SCREEN_END_MS for t in c.body_trades(late)):
        raise SystemExit("an entry at 2024-01-01 was kept")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_sign_does_not_matter()
    test_window_and_fill()
    print("fp26 pins ok")


if __name__ == "__main__":
    main()
