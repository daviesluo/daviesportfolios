"""The fifty-first search (fp51). The fill and the null are fp5's.

Nothing here reads the network or a file. An hourly bar is (low,). A daily
bar is (open,). The signal is how many of the 24 hours have a low strictly
above that day's open. The hour's own close does not enter. The fill reads
a later daily open.
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


def above_at(
    daily: dict[int, tuple],
    hours: dict[int, tuple],
    day: int,
    end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """Hours whose low held above the day's open. None when the open or an hour is missing."""
    if day >= end_ms:
        return None
    opened = daily.get(day)
    if opened is None or len(opened) < 1 or opened[0] <= 0:
        return None
    day_open = opened[0]
    count = 0
    for i in range(HOURS):
        bar = hours.get(day + i * HOUR_MS)
        if bar is None or len(bar) < 1 or bar[0] <= 0:
            return None
        if bar[0] > day_open:
            count += 1
    return float(count)


def above_prints(
    daily: dict[int, tuple],
    hours: dict[int, tuple],
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not hours or not daily:
        return []
    out = []
    start = min(hours) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = above_at(daily, hours, day, end_ms)
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


def above_signal_days(
    daily: dict[int, tuple],
    hours: dict[int, tuple],
    q: float = 0.90,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(above_prints(daily, hours, end_ms), q)


def above_trades(
    daily: dict[int, tuple],
    hours: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after a day that held above its open. Hold one day."""
    trades = []
    for day in above_signal_days(daily, hours, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
