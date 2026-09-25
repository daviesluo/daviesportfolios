"""Pins for the fp28 rule. No file and no return from 2023 is read.

    python3 docs/agents/scripts/fp28/pin_test.py
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def day_hours(day: int, volumes: list[float], closes: list[float]) -> dict[int, tuple]:
    """Each hour opens at 100. The third field is quote volume."""
    if len(volumes) != c.HOURS or len(closes) != c.HOURS:
        raise SystemExit("a day fixture needs 24 hours")
    hours = {}
    for k, (volume, close) in enumerate(zip(volumes, closes)):
        hours[day + k * c.HOUR_MS] = (100.0, close, volume)
    return hours


def lined(scale_volume: float = 1.0, scale_move: float = 1.0, down: bool = False) -> tuple[list[float], list[float]]:
    """Quote volume and absolute return rise together. Sign is optional."""
    volumes = []
    closes = []
    for k in range(c.HOURS):
        step = (k + 1) / 1000.0
        volumes.append(scale_volume * (k + 1))
        signed = -step if down else step
        closes.append(100.0 * (1.0 + scale_move * signed))
    return volumes, closes


def near(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= 1e-9


def zero_pair() -> tuple[list[float], list[float]]:
    """Four equal blocks. Volume and the move are uncorrelated."""
    specs = [(1.0, 0.125)] * 6 + [(1.0, 0.25)] * 6 + [(2.0, 0.125)] * 6 + [(2.0, 0.25)] * 6
    volumes = [volume for volume, _ in specs]
    closes = [100.0 * (1.0 + move) for _, move in specs]
    return volumes, closes


def book(start: int, n_days: int, last: str) -> dict[int, tuple]:
    hours: dict[int, tuple] = {}
    for i in range(n_days):
        kind = "zero" if i < n_days - 1 else last
        if kind == "zero":
            volumes, closes = zero_pair()
        elif kind == "up":
            volumes, closes = lined()
        elif kind == "down":
            volumes, closes = lined(down=True)
        elif kind == "against":
            volumes, closes = lined()
            volumes = list(reversed(volumes))
        else:
            raise SystemExit(f"unknown day {kind}")
        hours.update(day_hours(start + i * c.fp5.DAY_MS, volumes, closes))
    return hours


def test_formula() -> None:
    start = c.fp5.SCREEN_START_MS
    volumes, closes = lined()
    got = c.impact_at(day_hours(start, volumes, closes), start)
    if not near(got, 1.0):
        raise SystemExit(f"volume and the move lined up were not 1: {got}")
    down_v, down_c = lined(down=True)
    if not near(c.impact_at(day_hours(start, down_v, down_c), start), 1.0):
        raise SystemExit("a day of down hours changed the correlation")
    big_v, big_c = lined(scale_volume=1000.0, scale_move=3.0)
    if not near(c.impact_at(day_hours(start, big_v, big_c), start), 1.0):
        raise SystemExit("scaling volume or the move changed the correlation")
    against_v, against_c = lined()
    against = c.impact_at(day_hours(start, list(reversed(against_v)), against_c), start)
    if not near(against, -1.0):
        raise SystemExit(f"the same volumes, paired the other way, were not -1: {against}")
    zero_v, zero_c = zero_pair()
    zero = c.impact_at(day_hours(start, zero_v, zero_c), start)
    if not near(zero, 0.0):
        raise SystemExit(f"the four-block day was not 0: {zero}")
    hand = c._corr([1.0, 2.0, 3.0], [1.0, 2.0, 4.0])
    expected = (27.0 / 28.0) ** 0.5
    if hand is None or abs(hand - expected) > 1e-12:
        raise SystemExit(f"the three-point correlation was not sqrt(27/28): {hand}")
    flat = day_hours(start, list(volumes), [100.0] * c.HOURS)
    if c.impact_at(flat, start) is not None:
        raise SystemExit("a day of flat hours was a print")
    same_volume = day_hours(start, [5.0] * c.HOURS, closes)
    if c.impact_at(same_volume, start) is not None:
        raise SystemExit("a day of equal quote volume was a print")
    short = day_hours(start, volumes, closes)
    del short[start + 5 * c.HOUR_MS]
    if c.impact_at(short, start) is not None:
        raise SystemExit("a missing hour was a print")
    no_quote = {t: (bar[0], bar[1]) for t, bar in day_hours(start, volumes, closes).items()}
    if c.impact_at(no_quote, start) is not None:
        raise SystemExit("a bar without quote volume was a print")
    bad = day_hours(start, volumes, closes)
    bad[start] = (0.0, 101.0, 1.0)
    if c.impact_at(bad, start) is not None:
        raise SystemExit("a zero open was a print")
    negative = day_hours(start, volumes, closes)
    negative[start] = (100.0, 101.0, -1.0)
    if c.impact_at(negative, start) is not None:
        raise SystemExit("a negative quote volume was a print")
    later = day_hours(c.fp5.SCREEN_END_MS, volumes, closes)
    if c.impact_at(later, c.fp5.SCREEN_END_MS) is not None:
        raise SystemExit("a 2024 day was a print")
    if not near(c.impact_at(later, c.fp5.SCREEN_END_MS, c.fp5.SCREEN_END_MS + c.fp5.DAY_MS), 1.0):
        raise SystemExit("a later horizon still dropped the 2024 day")


def test_strict_quantile() -> None:
    points = [(i * c.fp5.DAY_MS, 0.0) for i in range(91)]
    if c._upper(points, 0.90):
        raise SystemExit("a value equal to its own 90th fired")
    points[-1] = (points[-1][0], 0.1)
    if points[-1][0] not in c._upper(points, 0.90):
        raise SystemExit("a value above its own 90th did not fire")
    points[-1] = (points[-1][0], -1.0)
    if c._upper(points, 0.90):
        raise SystemExit("a low correlation was returned")
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
    hot = book(start, 150, "up")
    last = start + 149 * c.fp5.DAY_MS
    if c.impact_signal_days(hot) != [last]:
        raise SystemExit("a day of lined-up volume and moves did not fire on its own")
    cold = book(start, 150, "against")
    if c.impact_signal_days(cold):
        raise SystemExit("the low correlation was scored")
    down = book(start, 150, "down")
    if c.impact_signal_days(down) != [last]:
        raise SystemExit("the sign of the hours blocked a lined-up day")
    gapped = dict(hot)
    del gapped[last + 4 * c.HOUR_MS]
    if any(ts == last for ts, _ in c.impact_prints(gapped)):
        raise SystemExit("a day with a missing hour was scored")


def test_window_and_fill() -> None:
    start = c.fp5.SCREEN_START_MS - 40 * c.fp5.DAY_MS
    hours = book(start, 150, "up")
    signal = start + 149 * c.fp5.DAY_MS
    entry = signal + c.fp5.DAY_MS
    exit_ = entry + c.fp5.DAY_MS
    daily = {entry: (100.0,), exit_: (101.0,)}
    untouched = c.impact_at(hours, signal)
    daily[entry] = (50.0,)
    daily[exit_] = (200.0,)
    if c.impact_at(hours, signal) != untouched:
        raise SystemExit("the daily open leaked into the signal")
    daily[entry] = (100.0,)
    daily[exit_] = (101.0,)
    filled = [t for t in c.impact_trades(daily, hours) if t["entry_ms"] == entry]
    if len(filled) != 1:
        raise SystemExit(f"entry must be the next daily open: {filled}")
    if any(t["entry_ms"] == signal for t in c.impact_trades(daily, hours)):
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
    if any(t["entry_ms"] == entry for t in c.impact_trades(daily, hours)):
        raise SystemExit("a hold crossed a missing day")

    late_start = c.fp5.SCREEN_END_MS - 120 * c.fp5.DAY_MS
    late = book(late_start, 120, "up")
    boundary = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if boundary not in c.impact_signal_days(late):
        raise SystemExit("the last 2023 signal should be a candidate")
    late_daily = {
        c.fp5.SCREEN_END_MS: (100.0,),
        c.fp5.SCREEN_END_MS + c.fp5.DAY_MS: (101.0,),
    }
    if any(t["entry_ms"] >= c.fp5.SCREEN_END_MS for t in c.impact_trades(late_daily, late)):
        raise SystemExit("an entry at 2024-01-01 was kept")
    horizon = c.fp5.SCREEN_END_MS + 2 * c.fp5.DAY_MS
    kept = [
        t for t in c.impact_trades(late_daily, late, end_ms=horizon)
        if t["entry_ms"] == c.fp5.SCREEN_END_MS
    ]
    if len(kept) != 1:
        raise SystemExit("a later horizon still dropped the boundary entry")
    after = dict(late)
    after.update(day_hours(c.fp5.SCREEN_END_MS, *lined()))
    if any(ts >= c.fp5.SCREEN_END_MS for ts, _ in c.impact_prints(after)):
        raise SystemExit("a 2024 day was a print")
    if not any(
        ts == c.fp5.SCREEN_END_MS
        for ts, _ in c.impact_prints(after, c.fp5.SCREEN_END_MS + c.fp5.DAY_MS)
    ):
        raise SystemExit("a later horizon still dropped the 2024 day")


def main() -> None:
    test_formula()
    test_strict_quantile()
    test_tail()
    test_window_and_fill()
    print("fp28 pins ok")


if __name__ == "__main__":
    main()
