"""Pins for the fp15 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp15/pin_test.py
"""

from __future__ import annotations

import math
import statistics
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _bar(open_px: float, close_px: float) -> tuple:
    return (open_px, open_px, open_px, close_px, 1.0)


def book_from_returns(start: int, returns: list[float]) -> dict[int, tuple]:
    """Bar opens at `start + i days`. Its close is the previous close times one plus the return."""
    daily = {start - c.fp5.DAY_MS: _bar(100.0, 100.0)}
    prev = 100.0
    for i, ret in enumerate(returns):
        close = prev * (1.0 + ret)
        daily[start + i * c.fp5.DAY_MS] = _bar(prev, close)
        prev = close
    return daily


def test_formula() -> None:
    hand = math.sqrt(336 / 343)
    got = c.population_stdev([1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 1.0])
    if got is None or abs(got - hand) > 1e-12:
        raise SystemExit(f"population stdev is not the second moment: {got}")
    if abs(got - statistics.stdev([1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 1.0])) < 1e-9:
        raise SystemExit("the moment was divided by n - 1")
    if c.population_stdev([0.01] * 7) is not None:
        raise SystemExit("a flat window was a print")

    # Large simple returns, so a log-return vol is a different number.
    returns = [0.50, -0.20, 0.40, -0.10, 0.30, -0.25, 0.15]
    simple = c.population_stdev(returns)
    logs = [math.log(1.0 + r) for r in returns]
    logged = c.population_stdev(logs)
    if simple is None or logged is None or abs(simple - logged) < 1e-6:
        raise SystemExit("simple and log vol collapsed")
    start = c.fp5.SCREEN_START_MS
    # 23 quiet days, then the seven returns above. The long window is not flat.
    quiet = [0.02 if i % 2 == 0 else -0.02 for i in range(23)]
    daily = book_from_returns(start - 40 * c.fp5.DAY_MS, quiet + returns)
    day = start - 40 * c.fp5.DAY_MS + (len(quiet) + len(returns) - 1) * c.fp5.DAY_MS
    short = c.population_stdev(returns)
    long_returns = (quiet + returns)[-30:]
    long = c.population_stdev(long_returns)
    if short is None or long is None:
        raise SystemExit("the fixture windows are flat")
    got_ratio = c.ratio_at(daily, day)
    if got_ratio is None or abs(got_ratio - short / long) > 1e-12:
        raise SystemExit(f"ratio is not short vol over long vol: {got_ratio}")
    log_ratio = c.population_stdev([math.log(1.0 + r) for r in returns]) / c.population_stdev(
        [math.log(1.0 + r) for r in long_returns]
    )
    if abs(got_ratio - log_ratio) < 1e-6:
        raise SystemExit("the ratio used log returns")


def _alternating(n: int, scale: float = 0.02) -> list[float]:
    return [scale if i % 2 == 0 else -scale for i in range(n)]


def test_strict_quantile() -> None:
    """Equal to the 90th does not fire. The low tail is not returned. Float noise is not this test."""
    points = [(i * c.fp5.DAY_MS, 1.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 1.01)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")
    points[-1] = (points[-1][0], 0.50)
    if c._upper(points, 0.90):
        raise SystemExit("the low tail was returned")
    # History is 0..89. floor(0.90*(90-1))=80, so the 90th is 80.
    # floor(0.80*89)=71, so 75 clears the 80th and not the screen's 90th.
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
    start = c.fp5.SCREEN_START_MS - 80 * c.fp5.DAY_MS
    hot_returns = _alternating(200)
    hot_returns[-1] = 0.50
    hot = book_from_returns(start, hot_returns)
    last = start + 199 * c.fp5.DAY_MS
    if last not in c.ratio_signal_days(hot):
        raise SystemExit("a short window that dwarfs the long one did not fire")
    cold_returns = _alternating(200)
    for i in range(193, 200):
        cold_returns[i] = 0.001 if i % 2 == 0 else -0.001
    cold = book_from_returns(start, cold_returns)
    if last in c.ratio_signal_days(cold):
        raise SystemExit("the low ratio was scored")
    # High and low are not inputs. Absurd wicks must not move the print.
    marked = {t: (bar[0], 1e9, 1e-9, bar[3], bar[4]) for t, bar in hot.items()}
    if c.ratio_prints(marked) != c.ratio_prints(hot):
        raise SystemExit("the range moved the ratio")
    gapped = dict(hot)
    del gapped[last - 10 * c.fp5.DAY_MS]
    if any(ts == last for ts, _ in c.ratio_prints(gapped)):
        raise SystemExit("a hole inside the long window was scored")
    flat = book_from_returns(start, [0.01] * 200)
    if c.ratio_prints(flat):
        raise SystemExit("zero variance was scored")


def test_window_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 80 * c.fp5.DAY_MS
    returns = _alternating(200)
    returns[-1] = 0.50
    daily = book_from_returns(start, returns)
    signal = start + 199 * c.fp5.DAY_MS
    entry = signal + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily[entry] = _bar(100.0, 100.0)
    daily[exit_] = _bar(101.0, 101.0)
    # The bars after the signal are not part of its ratio.
    untouched = c.ratio_at(book_from_returns(start, returns), signal)
    if c.ratio_at(daily, signal) != untouched:
        raise SystemExit("a later bar leaked into the signal")
    filled = [t for t in c.ratio_trades(daily) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit(f"entry must be the next open: {filled}")
    if filled[0]["exit_ms"] != exit_:
        raise SystemExit("the hold is not one day")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    del daily[exit_]
    if any(t["entry_ms"] == entry for t in c.ratio_trades(daily)):
        raise SystemExit("a hold crossed a missing bar")

    # A signal known on the last 2023 day would enter on 2024-01-01.
    late_start = c.fp5.SCREEN_END_MS - 220 * c.fp5.DAY_MS
    late_returns = _alternating(220)
    late_returns[-1] = 0.50
    late = book_from_returns(late_start, late_returns)
    boundary = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if boundary not in c.ratio_signal_days(late):
        raise SystemExit("the last 2023 signal should be a candidate")
    if any(t["entry_ms"] >= c.fp5.SCREEN_END_MS for t in c.ratio_trades(late)):
        raise SystemExit("an entry at 2024-01-01 was kept")
    after = dict(late)
    after[c.fp5.SCREEN_END_MS] = _bar(100.0, 250.0)
    if any(ts >= c.fp5.SCREEN_END_MS for ts, _ in c.ratio_prints(after)):
        raise SystemExit("a 2024 bar was a print")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail()
    test_window_and_fill()
    print("fp15 pins ok")


if __name__ == "__main__":
    main()
