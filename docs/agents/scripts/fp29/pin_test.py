"""Pins for the fp29 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp29/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-12


def book(start: int, n_days: int, last_close: float, spike_at: int | None = None, spike: float = 100.0) -> dict[int, tuple]:
    """Opens stay at 50. Closes stay at 100, except the last day and an optional spike."""
    daily = {}
    for i in range(n_days):
        close = last_close if i == n_days - 1 else 100.0
        if spike_at is not None and i == spike_at:
            close = spike
        daily[start + i * c.fp5.DAY_MS] = (50.0, close)
    return daily


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    flat = book(start, c.PRIOR + 1, 110.0)
    day = start + c.PRIOR * c.fp5.DAY_MS
    got = c.peak_at(flat, day)
    if not near(got, 0.1):
        raise SystemExit(f"a close 10% through a flat high was not 0.1: {got}")
    scaled = {t: (bar[0] * 3.0, bar[1] * 3.0) for t, bar in flat.items()}
    if not near(c.peak_at(scaled, day), 0.1):
        raise SystemExit("scaling the closes moved the distance")
    opened = {t: (1.0, bar[1]) for t, bar in flat.items()}
    if not near(c.peak_at(opened, day), 0.1):
        raise SystemExit("the daily open moved the distance")
    old = book(start, c.PRIOR + 1, 100.0)
    old[start] = (50.0, 50.0)
    if not near(c.peak_at(old, day), 0.0):
        raise SystemExit("a 30-day return was used instead of the highest close")
    spiked = book(start, c.PRIOR + 1, 150.0, spike_at=c.PRIOR - 1, spike=200.0)
    dist = c.peak_at(spiked, day)
    if not near(dist, -0.25):
        raise SystemExit(f"a close under yesterday's high was not -0.25: {dist}")
    short = dict(flat)
    del short[start + 4 * c.fp5.DAY_MS]
    if c.peak_at(short, day) is not None:
        raise SystemExit("a missing prior day was a print")
    bad = dict(flat)
    bad[day] = (50.0, 0.0)
    if c.peak_at(bad, day) is not None:
        raise SystemExit("a zero close was a print")
    later = {c.fp5.SCREEN_END_MS: (50.0, 110.0)}
    later.update(book(c.fp5.SCREEN_END_MS - c.PRIOR * c.fp5.DAY_MS, c.PRIOR, 100.0))
    if c.peak_at(later, c.fp5.SCREEN_END_MS) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.peak_at(later, c.fp5.SCREEN_END_MS, c.fp5.SCREEN_END_MS + c.fp5.DAY_MS), 0.1):
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.01)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")
    points[-1] = (points[-1][0], -0.2)
    if c._upper(points, 0.90):
        raise SystemExit("a close under the prior high was returned")
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
    hot = book(start, c.PRIOR + 91, 110.0)
    last = start + (c.PRIOR + 90) * c.fp5.DAY_MS
    if c.peak_signal_days(hot) != [last]:
        raise SystemExit("a close through its prior high did not fire on its own")
    cold = book(start, c.PRIOR + 91, 90.0)
    if c.peak_signal_days(cold):
        raise SystemExit("a close under the prior high was scored")
    gapped = dict(hot)
    del gapped[last - 3 * c.fp5.DAY_MS]
    if any(ts == last for ts, _ in c.peak_prints(gapped)):
        raise SystemExit("a day with a hole in the prior 30 was scored")


def test_window_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    daily = book(start, c.PRIOR + 91, 110.0)
    signal = start + (c.PRIOR + 90) * c.fp5.DAY_MS
    entry = signal + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily[entry] = (100.0, 100.0)
    daily[exit_] = (101.0, 101.0)
    untouched = c.peak_at(daily, signal)
    daily[entry] = (50.0, 100.0)
    daily[exit_] = (200.0, 200.0)
    if c.peak_at(daily, signal) != untouched:
        raise SystemExit("the next opens leaked into the signal")
    daily[entry] = (100.0, 100.0)
    daily[exit_] = (101.0, 101.0)
    filled = [t for t in c.peak_trades(daily) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit(f"entry must be the next daily open: {filled}")
    if any(t["entry_ms"] == signal for t in c.peak_trades(daily)):
        raise SystemExit("the signal day was the entry")
    if filled[0]["coin"] != "BTCUSDT":
        raise SystemExit("the coin is not BTCUSDT")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    saved = daily.pop(exit_)
    if any(t["entry_ms"] == entry for t in c.peak_trades(daily)):
        raise SystemExit("a hold crossed a missing day")
    daily[exit_] = saved

    boundary = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    late_start = boundary - (c.PRIOR + 90) * c.fp5.DAY_MS
    late = book(late_start, c.PRIOR + 91, 110.0)
    if boundary not in c.peak_signal_days(late):
        raise SystemExit("the last 2023 signal should be a candidate")
    late[c.fp5.SCREEN_END_MS] = (100.0, 100.0)
    late[c.fp5.SCREEN_END_MS + c.fp5.DAY_MS] = (101.0, 101.0)
    if any(t["entry_ms"] >= c.fp5.SCREEN_END_MS for t in c.peak_trades(late)):
        raise SystemExit("an entry at 2024-01-01 was kept")
    horizon = c.fp5.SCREEN_END_MS + 2 * c.fp5.DAY_MS
    kept = [t for t in c.peak_trades(late, end_ms=horizon) if t["entry_ms"] == c.fp5.SCREEN_END_MS]
    if len(kept) != 1:
        raise SystemExit("a later horizon still dropped the boundary entry")
    after = dict(late)
    after[c.fp5.SCREEN_END_MS] = (50.0, 110.0)
    if any(ts >= c.fp5.SCREEN_END_MS for ts, _ in c.peak_prints(after)):
        raise SystemExit("a 2024 day was a print")
    if not any(ts == c.fp5.SCREEN_END_MS for ts, _ in c.peak_prints(after, c.fp5.SCREEN_END_MS + c.fp5.DAY_MS)):
        raise SystemExit("a later horizon still dropped the 2024 day")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail()
    test_window_and_fill()
    print("fp29 pins ok")


if __name__ == "__main__":
    main()
