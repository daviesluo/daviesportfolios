"""Pins for the fp23 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp23/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def day_hours(day: int, ups: list[bool], crash: int | None = None) -> dict[int, tuple]:
    """Each hour opens at 100. An up hour closes at 101. A crash hour closes at 50."""
    if len(ups) != c.HOURS:
        raise SystemExit("a day fixture needs 24 hours")
    hours = {}
    for k, up in enumerate(ups):
        close = 101.0 if up else 99.0
        if crash == k:
            close = 50.0
        hours[day + k * c.HOUR_MS] = (100.0, close)
    return hours


def pattern(n_up: int, hour0: bool = True) -> list[bool]:
    """n_up True flags. hour0 picks whether the ups sit at the start of the day."""
    flags = [False] * c.HOURS
    slots = range(n_up) if hour0 else range(c.HOURS - n_up, c.HOURS)
    for k in slots:
        flags[k] = True
    return flags


def book(start: int, n_days: int, last_up: int | None) -> dict[int, tuple]:
    hours: dict[int, tuple] = {}
    for i in range(n_days):
        n_up = 12 if i < n_days - 1 or last_up is None else last_up
        hours.update(day_hours(start + i * c.fp5.DAY_MS, pattern(n_up)))
    return hours


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    if c.share_at(day_hours(start, [True] * 24), start) != 1.0:
        raise SystemExit("a day of up hours was not 1")
    if c.share_at(day_hours(start, [False] * 24), start) != 0.0:
        raise SystemExit("a day of down hours was not 0")
    half = c.share_at(day_hours(start, pattern(12)), start)
    if half != 0.5:
        raise SystemExit(f"twelve up hours were not 0.5: {half}")
    early = c.share_at(day_hours(start, pattern(1, True)), start)
    late = c.share_at(day_hours(start, pattern(1, False)), start)
    if early != 1.0 / 24.0 or late != early:
        raise SystemExit("the clock hour changed the share")
    flat = day_hours(start, [True] * 24)
    flat[start] = (100.0, 100.0)
    if c.share_at(flat, start) != 23.0 / 24.0:
        raise SystemExit("a flat hour counted as up")
    crash = day_hours(start, [True] * 24, crash=11)
    if c.share_at(crash, start) != 23.0 / 24.0:
        raise SystemExit("one crash hour erased the other up hours")
    scaled = {t: (bar[0] * 3.0, bar[1] * 3.0) for t, bar in crash.items()}
    if c.share_at(scaled, start) != c.share_at(crash, start):
        raise SystemExit("scaling the path moved the share")
    with_quote = {t: (bar[0], bar[1], 1.0e9) for t, bar in day_hours(start, pattern(12)).items()}
    if c.share_at(with_quote, start) != 0.5:
        raise SystemExit("a volume field moved the share")
    short = day_hours(start, pattern(12))
    del short[start + 5 * c.HOUR_MS]
    if c.share_at(short, start) is not None:
        raise SystemExit("a missing hour was a print")
    bad = day_hours(start, pattern(12))
    bad[start] = (0.0, 100.0)
    if c.share_at(bad, start) is not None:
        raise SystemExit("a zero open was a print")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.5) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.5 + 1.0 / 24.0)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")
    points[-1] = (points[-1][0], 0.0)
    if c._upper(points, 0.90):
        raise SystemExit("a day of down hours was returned")
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
    hot = book(start, 150, 24)
    last = start + 149 * c.fp5.DAY_MS
    if c.share_signal_days(hot) != [last]:
        raise SystemExit("a day of up hours did not fire on its own")
    cold = book(start, 150, 0)
    if c.share_signal_days(cold):
        raise SystemExit("a day of down hours was scored")
    gapped = dict(hot)
    del gapped[last + 4 * c.HOUR_MS]
    if any(ts == last for ts, _ in c.share_prints(gapped)):
        raise SystemExit("a day with a missing hour was scored")


def test_window_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = book(start, 150, 24)
    signal = start + 149 * c.fp5.DAY_MS
    entry = signal + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    untouched = c.share_at(hours, signal)
    daily[entry] = (50.0,)
    daily[exit_] = (200.0,)
    if c.share_at(hours, signal) != untouched:
        raise SystemExit("the daily open leaked into the signal")
    daily[entry] = (100.0,)
    daily[exit_] = (101.0,)
    filled = [t for t in c.share_trades(daily, hours) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit(f"entry must be the next daily open: {filled}")
    if any(t["entry_ms"] == signal for t in c.share_trades(daily, hours)):
        raise SystemExit("the signal day was the entry")
    if filled[0]["coin"] != "BTCUSDT":
        raise SystemExit("the coin is not BTCUSDT")
    if filled[0]["exit_ms"] - filled[0]["entry_ms"] != c.fp5.DAY_MS:
        raise SystemExit("the hold is not one day")
    bought = Decimal(100) * Decimal("1.001")
    sold = Decimal(101) * Decimal("0.999")
    if abs(filled[0]["net"] - float(sold / bought - 1)) > 1e-12:
        raise SystemExit("the fill is not fp5's")
    del daily[exit_]
    if any(t["entry_ms"] == entry for t in c.share_trades(daily, hours)):
        raise SystemExit("a hold crossed a missing day")

    late_start = c.fp5.SCREEN_END_MS - 120 * c.fp5.DAY_MS
    late = book(late_start, 120, 24)
    boundary = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if boundary not in c.share_signal_days(late):
        raise SystemExit("the last 2023 signal should be a candidate")
    late_daily = {
        c.fp5.SCREEN_END_MS: (100.0,),
        c.fp5.SCREEN_END_MS + c.fp5.DAY_MS: (101.0,),
    }
    if any(t["entry_ms"] >= c.fp5.SCREEN_END_MS for t in c.share_trades(late_daily, late)):
        raise SystemExit("an entry at 2024-01-01 was kept")
    after = dict(late)
    after[c.fp5.SCREEN_END_MS] = (100.0, 200.0)
    if any(ts >= c.fp5.SCREEN_END_MS for ts, _ in c.share_prints(after)):
        raise SystemExit("a 2024 day was a print")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail()
    test_window_and_fill()
    print("fp23 pins ok")


if __name__ == "__main__":
    main()
