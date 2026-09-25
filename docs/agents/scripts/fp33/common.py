"""The thirty-third search (fp33). The fill and the null are fp5's.

Nothing here reads the network or a file. A daily bar is (open, low).
The signal is today's low divided by yesterday's low, minus 1. The open
is not the signal. The fill reads a later daily open.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "fp5_common",
    Path(__file__).resolve().parents[1] / "fp5" / "common.py",
)
fp5 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(fp5)

MIN_N = 30


def lift_at(
    daily: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """Today's low over yesterday's low, minus 1. None when a day is missing."""
    if day >= end_ms:
        return None
    prev = day - fp5.DAY_MS
    if prev >= end_ms:
        return None
    today = daily.get(day)
    yday = daily.get(prev)
    if today is None or yday is None or len(today) < 2 or len(yday) < 2:
        return None
    low = today[1]
    prior = yday[1]
    if low <= 0 or prior <= 0:
        return None
    return low / prior - 1.0


def lift_prints(
    daily: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not daily:
        return []
    prints = []
    start = min(daily) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = lift_at(daily, day, end_ms)
        if value is None:
            continue
        prints.append((day, value))
    return prints


def _upper(points: list[tuple[int, float]], q: float) -> list[int]:
    points = sorted(points)
    out = []
    for i, (ts, value) in enumerate(points):
        hist = [
            points[j][1]
            for j in range(i)
            if ts - 90 * fp5.DAY_MS <= points[j][0] < ts
        ]
        thr = fp5.rank_threshold(hist, q, 90)
        if thr is None or not value > thr:
            continue
        out.append(ts)
    return out


def lift_signal_days(
    daily: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(lift_prints(daily, end_ms), q)


def lift_trades(
    daily: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after a day whose low lifted unusually far. Hold one day."""
    trades = []
    for day in lift_signal_days(daily, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
