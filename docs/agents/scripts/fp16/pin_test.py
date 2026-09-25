"""Pins for the fp16 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp16/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _hour(ret: float) -> tuple:
    return (100.0, 100.0, 100.0, 100.0 * (1.0 + ret), 1.0)


def _day(hourly: dict[int, tuple], day: int, returns: list[float]) -> None:
    if len(returns) != c.HOURS:
        raise SystemExit("a day needs 24 hours")
    for i, ret in enumerate(returns):
        hourly[day + i * c.HOUR_MS] = _hour(ret)


def _alternating(scale: float = 0.01) -> list[float]:
    return [scale if i % 2 == 0 else -scale for i in range(c.HOURS)]


def _trend() -> list[float]:
    return [0.001 * (i + 1) for i in range(c.HOURS)]


def book(start: int, n_days: int, last: list[float] | None, history: list[float]) -> dict[int, tuple]:
    hourly: dict[int, tuple] = {}
    for i in range(n_days):
        _day(hourly, start + i * c.fp5.DAY_MS, history if i < n_days - 1 or last is None else last)
    return hourly


def test_formula() -> None:
    perfect = c.population_corr([1.0, 2.0, 3.0], [2.0, 3.0, 4.0])
    if perfect is None or abs(perfect - 1.0) > 1e-12:
        raise SystemExit(f"a unit slope is not 1: {perfect}")
    opposite = c.population_corr([1.0, 2.0, 3.0], [-1.0, -2.0, -3.0])
    if opposite is None or abs(opposite - (-1.0)) > 1e-12:
        raise SystemExit(f"the opposite slope is not -1: {opposite}")
    if c.population_corr([1.0, 1.0, 1.0], [1.0, 2.0, 3.0]) is not None:
        raise SystemExit("a flat series was a correlation")
    # 1, 2, …, 24 is a unit slope, so the day's lag-1 correlation is 1.
    start = c.fp5.SCREEN_START_MS
    hourly: dict[int, tuple] = {}
    _day(hourly, start, [float(i) for i in range(1, 25)])
    if abs(c.corr_at(hourly, start) - 1.0) > 1e-12:
        raise SystemExit("a trending day was not correlation 1")
    flat: dict[int, tuple] = {}
    _day(flat, start, [0.0] * 24)
    if c.corr_at(flat, start) is not None:
        raise SystemExit("a flat day was a print")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.01)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")
    points[-1] = (points[-1][0], -1.0)
    if c._upper(points, 0.90):
        raise SystemExit("the negative tail was returned")
    # History is 0..89. The 90th is 80. The 80th is 71. 75 clears only the neighbour.
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
    hot = book(start, 150, _trend(), _alternating())
    last = start + 149 * c.fp5.DAY_MS
    if last not in c.corr_signal_days(hot):
        raise SystemExit("a trending day after choppy ones did not fire")
    cold = book(start, 150, _alternating(0.05), _trend())
    if last in c.corr_signal_days(cold):
        raise SystemExit("the negative tail was scored")
    marked = {t: (bar[0], 1e9, 1e-9, bar[3], bar[4]) for t, bar in hot.items()}
    if c.corr_prints(marked) != c.corr_prints(hot):
        raise SystemExit("the range moved the correlation")
    gapped = dict(hot)
    del gapped[last + 5 * c.HOUR_MS]
    if any(ts == last for ts, _ in c.corr_prints(gapped)):
        raise SystemExit("a day missing an hour was scored")


def test_window_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hourly = book(start, 150, _trend(), _alternating())
    signal = start + 149 * c.fp5.DAY_MS
    entry = signal + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    untouched = c.corr_at(hourly, signal)
    later = dict(hourly)
    _day(later, entry, [0.2, -0.2] * 12)
    if c.corr_at(later, signal) != untouched:
        raise SystemExit("the next day leaked into the signal")
    daily = {
        entry: (100.0, 100.0, 100.0, 100.0, 1.0),
        exit_: (101.0, 101.0, 101.0, 101.0, 1.0),
    }
    filled = [t for t in c.corr_trades(hourly, daily) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit(f"entry must be the next daily open: {filled}")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    del daily[exit_]
    if any(t["entry_ms"] == entry for t in c.corr_trades(hourly, daily)):
        raise SystemExit("a hold crossed a missing day")

    late_start = c.fp5.SCREEN_END_MS - 120 * c.fp5.DAY_MS
    late = book(late_start, 120, _trend(), _alternating())
    boundary = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if boundary not in c.corr_signal_days(late):
        raise SystemExit("the last 2023 signal should be a candidate")
    if any(t["entry_ms"] >= c.fp5.SCREEN_END_MS for t in c.corr_trades(late, {})):
        raise SystemExit("an entry at 2024-01-01 was kept")
    after = dict(late)
    after[c.fp5.SCREEN_END_MS] = _hour(0.5)
    if any(ts >= c.fp5.SCREEN_END_MS for ts, _ in c.corr_prints(after)):
        raise SystemExit("a 2024 hour opened a print")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail()
    test_window_and_fill()
    print("fp16 pins ok")


if __name__ == "__main__":
    main()
