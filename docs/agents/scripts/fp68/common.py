"""The sixty-eighth search (fp68). The fill and the null are fp5's.

Nothing here reads the network or a file. An hourly bar is (close,).
A daily bar is (open,). The signal counts how many of today's hourly
closes crossed yesterday's last close. A close that only changes the sign
of the hourly return, while staying on one side of that level, does not
count. The fill reads a later daily open.
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


def cross_at(
    hours: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """Crosses of yesterday's last close. None when today or that close is missing."""
    if day >= end_ms:
        return None
    level_bar = hours.get(day - fp5.DAY_MS + 23 * HOUR_MS)
    if level_bar is None or len(level_bar) < 1 or level_bar[0] <= 0:
        return None
    level = level_bar[0]
    closes: list[float] = []
    for i in range(HOURS):
        bar = hours.get(day + i * HOUR_MS)
        if bar is None or len(bar) < 1 or bar[0] <= 0:
            return None
        closes.append(bar[0])
    prev = 0
    n = 0
    for px in closes:
        if px > level:
            side = 1
        elif px < level:
            side = -1
        else:
            continue
        if prev != 0 and side != prev:
            n += 1
        prev = side
    return float(n)


def cross_prints(
    hours: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not hours:
        return []
    out = []
    start = min(hours) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = cross_at(hours, day, end_ms)
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


def cross_signal_days(
    hours: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(cross_prints(hours, end_ms), q)


def cross_trades(
    daily: dict[int, tuple],
    hours: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after many crosses of yesterday's close. Hold one day."""
    trades = []
    for day in cross_signal_days(hours, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
