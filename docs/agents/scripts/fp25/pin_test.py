"""Pins for the fp25 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp25/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def flat_then(last: float, n_hist: int = 90) -> list[tuple[int, float]]:
    """n_hist days of 100 coins on exchanges, then one day at `last`."""
    start = c.fp5.SCREEN_START_MS - n_hist * c.fp5.DAY_MS
    points = [(start + i * c.fp5.DAY_MS, 100.0) for i in range(n_hist)]
    points.append((start + n_hist * c.fp5.DAY_MS, last))
    return points


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    one = c.stock_prints([(start, 250_000.0)])
    if one != [(start, 250_000.0)]:
        raise SystemExit("a positive stock was not a print")
    if c.stock_prints([(start, 0.0)]) or c.stock_prints([(start, -1.0)]):
        raise SystemExit("a non-positive stock was a print")
    if c.stock_prints([(c.fp5.SCREEN_END_MS, 9.0)]):
        raise SystemExit("a 2024 stamp was a print")
    if c.stock_prints([(start, 1.0), (start, 2.0)]):
        raise SystemExit("a duplicate day was a print")
    book = flat_then(101.0)
    if book[-1][0] not in c.stock_signal_days(book):
        raise SystemExit("a higher stock did not fire before the scale check")
    scaled = [(d, f * 3.0) for d, f in book]
    if c.stock_signal_days(scaled) != c.stock_signal_days(book):
        raise SystemExit("scaling every day moved the signal")


def test_not_the_flow() -> None:
    """A large day's change that stays under the 90th does not fire. A one-coin step over it does."""
    start = c.fp5.SCREEN_START_MS - 90 * c.fp5.DAY_MS
    ladder = [(start + i * c.fp5.DAY_MS, 50.0) for i in range(80)]
    ladder += [(start + i * c.fp5.DAY_MS, 100.0) for i in range(80, 90)]
    last = start + 90 * c.fp5.DAY_MS
    # Previous print is 100. A drop of 40 is a large outflow, and 60 is under the 90th.
    if last in c.stock_signal_days(ladder + [(last, 60.0)]):
        raise SystemExit("a large outflow was treated as the signal")
    # Previous print is 100. One more coin clears the 90th. The flow is 1.
    if last not in c.stock_signal_days(ladder + [(last, 100.01)]):
        raise SystemExit("a stock above the 90th did not fire")
    if last in c.stock_signal_days(ladder + [(last, 100.0)]):
        raise SystemExit("a stock equal to the 90th fired")


def test_strict_quantile() -> None:
    if c.stock_signal_days(flat_then(100.0)):
        raise SystemExit("a stock equal to its own 90th fired")
    hot = flat_then(100.01)
    if hot[-1][0] not in c.stock_signal_days(hot):
        raise SystemExit("a stock above its own 90th did not fire")
    if c.stock_signal_days(flat_then(200.0, n_hist=89)):
        raise SystemExit("89 prints were enough")
    start = c.fp5.SCREEN_START_MS - 90 * c.fp5.DAY_MS
    ladder = [(start + i * c.fp5.DAY_MS, 1.0) for i in range(80)]
    ladder += [(start + i * c.fp5.DAY_MS, 10.0) for i in range(80, 90)]
    last = start + 90 * c.fp5.DAY_MS
    if last in c.stock_signal_days(ladder + [(last, 2.0)]):
        raise SystemExit("the 80th neighbour was treated as the screen cut")
    if last not in c.stock_signal_days(ladder + [(last, 2.0)], q=0.80):
        raise SystemExit("2 did not clear the 80th neighbour")
    if c.stock_signal_days(flat_then(1.0)):
        raise SystemExit("a thin stock was returned")


def test_window_and_fill() -> None:
    points = flat_then(101.0)
    signal = points[-1][0]
    entry = signal + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    if not (c.fp5.SCREEN_START_MS <= entry < c.fp5.SCREEN_END_MS):
        raise SystemExit("the fixture's entry is outside 2023")
    daily = {
        signal: (50.0, 9.0e9),
        entry: (100.0, 1.0),
        exit_: (101.0, 1.0),
    }
    if c.stock_signal_days(points) != [signal]:
        raise SystemExit("the full day did not fire on its own")
    filled = [t for t in c.stock_trades(daily, points) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit(f"entry must be the next daily open: {filled}")
    if any(t["entry_ms"] == signal for t in c.stock_trades(daily, points)):
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
    leaked[signal] = (1.0, 0.0)
    again = [t for t in c.stock_trades(leaked, points) if t["entry_ms"] == entry]
    if len(again) != 1 or abs(again[0]["net"] - filled[0]["net"]) > 1e-12:
        raise SystemExit("the signal day's open leaked into the fill")
    del daily[exit_]
    if any(t["entry_ms"] == entry for t in c.stock_trades(daily, points)):
        raise SystemExit("a hold crossed a missing day")

    boundary = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    hist = [(boundary - (90 - i) * c.fp5.DAY_MS, 100.0) for i in range(90)]
    late = hist + [(boundary, 101.0)]
    if boundary not in c.stock_signal_days(late):
        raise SystemExit("the last 2023 signal should be a candidate")
    late_daily = {
        c.fp5.SCREEN_END_MS: (100.0,),
        c.fp5.SCREEN_END_MS + c.fp5.DAY_MS: (101.0,),
    }
    if any(t["entry_ms"] >= c.fp5.SCREEN_END_MS for t in c.stock_trades(late_daily, late)):
        raise SystemExit("an entry at 2024-01-01 was kept")
    if any(ts >= c.fp5.SCREEN_END_MS for ts, _ in c.stock_prints(late + [(c.fp5.SCREEN_END_MS, 9.0)])):
        raise SystemExit("a 2024 day was a print")


def main() -> None:
    test_formula()
    test_not_the_flow()
    test_strict_quantile()
    test_window_and_fill()
    print("fp25 pins ok")


if __name__ == "__main__":
    main()
