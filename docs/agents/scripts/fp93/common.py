"""The ninety-third search (fp93). The fill and the null are fp5's.

Nothing here reads the network or a file. An hourly bar is (high, low).
A daily bar is (open,). The signal is hour 23's range divided by the range
of the 24 hours. The widest hour is not selected. The close is not stored.
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
HOUR_MS = fp5.DAY_MS // 24
HOURS = 24


def tailbar_at(
    hours: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """Last hour's range over the day's range. None when an hour is missing or the day is flat."""
    if day >= end_ms:
        return None
    day_high = None
    day_low = None
    last = None
    for i in range(HOURS):
        bar = hours.get(day + i * HOUR_MS)
        if bar is None or len(bar) < 2 or bar[0] <= 0 or bar[1] <= 0 or bar[0] < bar[1]:
            return None
        if day_high is None or bar[0] > day_high:
            day_high = bar[0]
        if day_low is None or bar[1] < day_low:
            day_low = bar[1]
        if i == 23:
            last = bar
    if last is None or day_high is None or day_low is None or day_high <= day_low:
        return None
    return (last[0] - last[1]) / (day_high - day_low)


def tailbar_prints(
    hours: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not hours:
        return []
    out = []
    start = min(hours) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = tailbar_at(hours, day, end_ms)
        if value is None:
            continue
        out.append((day, value))
    return out


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


def tailbar_signal_days(
    hours: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(tailbar_prints(hours, end_ms), q)


def tailbar_trades(
    daily: dict[int, tuple],
    hours: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after the last hour was a large part of the range. Hold one day."""
    trades = []
    for day in tailbar_signal_days(hours, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
