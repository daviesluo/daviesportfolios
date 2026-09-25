"""Pins for the fp27 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp27/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def counts(jumps: list[float], start_level: float = 1000.0) -> list[tuple[int, float]]:
    """One count per day. `jumps[i]` is the change into day i+1. Day 0 has no change."""
    start = c.fp5.SCREEN_START_MS - len(jumps) * c.fp5.DAY_MS
    level = start_level
    points = [(start, level)]
    for i, jump in enumerate(jumps):
        level += jump
        points.append((start + (i + 1) * c.fp5.DAY_MS, level))
    return points


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    up = c.change_prints([(start - c.fp5.DAY_MS, 1000.0), (start, 1010.0)])
    if up != [(start, 10.0)]:
        raise SystemExit(f"a rise of 10 was not a print: {up}")
    down = c.change_prints([(start - c.fp5.DAY_MS, 1000.0), (start, 990.0)])
    if down != [(start, -10.0)]:
        raise SystemExit("a fall was dropped from the history")
    if c.change_prints([(start, 1000.0)]):
        raise SystemExit("a day with no previous count was a print")
    if c.change_prints([(start - 2 * c.fp5.DAY_MS, 1000.0), (start, 1010.0)]):
        raise SystemExit("a gap of two days was filled in")
    if c.change_prints([(start - c.fp5.DAY_MS, 0.0), (start, 10.0)]):
        raise SystemExit("a zero count was a print")
    if c.change_prints([(start - c.fp5.DAY_MS, 10.0), (start, 10.0), (start, 12.0)]):
        raise SystemExit("a duplicate day was a print")
    if c.change_prints([(c.fp5.SCREEN_END_MS - c.fp5.DAY_MS, 10.0), (c.fp5.SCREEN_END_MS, 20.0)]):
        raise SystemExit("a 2024 day was a print")
    later = c.change_prints(
        [(c.fp5.SCREEN_END_MS - c.fp5.DAY_MS, 10.0), (c.fp5.SCREEN_END_MS, 20.0)],
        end_ms=c.fp5.SCREEN_END_MS + c.fp5.DAY_MS,
    )
    if later != [(c.fp5.SCREEN_END_MS, 10.0)]:
        raise SystemExit("a later horizon still dropped the 2024 day")
    low = counts([1.0] * 90 + [5.0], start_level=100.0)
    high = counts([1.0] * 90 + [5.0], start_level=1_000_000.0)
    if c.change_signal_days(low) != c.change_signal_days(high):
        raise SystemExit("the level of the count changed the signal")


def test_not_the_level() -> None:
    quiet = counts([1.0] * 91)
    if c.change_signal_days(quiet):
        raise SystemExit("a high stock with an ordinary change fired")
    hot = counts([1.0] * 90 + [5.0])
    if hot[-1][0] not in c.change_signal_days(hot):
        raise SystemExit("a large rise on a small stock did not fire")


def test_strict_quantile() -> None:
    tied = counts([1.0] * 91)
    if c.change_signal_days(tied):
        raise SystemExit("a change equal to its own 90th fired")
    if c.change_signal_days(counts([1.0] * 89 + [5.0])):
        raise SystemExit("89 prints were enough")
    fell = counts([-1.0] * 90 + [-0.5])
    if c.change_signal_days(fell):
        raise SystemExit("a smaller decline was treated as a rise")
    rebound = counts([-1.0] * 90 + [0.1])
    if rebound[-1][0] not in c.change_signal_days(rebound):
        raise SystemExit("a rise after a run of declines did not fire")
    jumps = [1.0] * 80 + [10.0] * 10
    last = c.fp5.SCREEN_START_MS
    mid = counts(jumps + [2.0])
    if last in c.change_signal_days(mid):
        raise SystemExit("the 80th neighbour was treated as the screen cut")
    if last not in c.change_signal_days(mid, q=0.80):
        raise SystemExit("2 did not clear the 80th neighbour")
    exact = counts(jumps + [10.0])
    if last in c.change_signal_days(exact):
        raise SystemExit("a change equal to the split book's 90th fired")
    over = counts(jumps + [11.0])
    if last not in c.change_signal_days(over):
        raise SystemExit("a change above the split book's 90th did not fire")


def test_window_and_fill() -> None:
    points = counts([1.0] * 90 + [5.0])
    signal = points[-1][0]
    entry = signal + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    if not (c.fp5.SCREEN_START_MS <= entry < c.fp5.SCREEN_END_MS):
        raise SystemExit("the fixture's entry is outside 2023")
    daily = {signal: (50.0,), entry: (100.0,), exit_: (101.0,)}
    filled = [t for t in c.change_trades(daily, points) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit(f"entry must be the next daily open: {filled}")
    if any(t["entry_ms"] == signal for t in c.change_trades(daily, points)):
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
    leaked[signal] = (1.0,)
    again = [t for t in c.change_trades(leaked, points) if t["entry_ms"] == entry]
    if len(again) != 1 or abs(again[0]["net"] - filled[0]["net"]) > 1e-12:
        raise SystemExit("the signal day's open leaked into the fill")
    del daily[exit_]
    if any(t["entry_ms"] == entry for t in c.change_trades(daily, points)):
        raise SystemExit("a hold crossed a missing day")

    boundary = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    level = 1000.0
    hist = []
    for i in range(92):
        day = boundary - (91 - i) * c.fp5.DAY_MS
        if i == 0:
            hist.append((day, level))
            continue
        level += 5.0 if day == boundary else 1.0
        hist.append((day, level))
    if boundary not in c.change_signal_days(hist):
        raise SystemExit("the last 2023 signal should be a candidate")
    late_daily = {
        c.fp5.SCREEN_END_MS: (100.0,),
        c.fp5.SCREEN_END_MS + c.fp5.DAY_MS: (101.0,),
    }
    if any(t["entry_ms"] >= c.fp5.SCREEN_END_MS for t in c.change_trades(late_daily, hist)):
        raise SystemExit("an entry at 2024-01-01 was kept")


def main() -> None:
    test_formula()
    test_not_the_level()
    test_strict_quantile()
    test_window_and_fill()
    print("fp27 pins ok")


if __name__ == "__main__":
    main()
