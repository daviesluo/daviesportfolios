"""The thirty-ninth search (fp39). The fill and the null are fp5's.

Nothing here reads the network or a file. An hourly bar is (high, low). A daily bar is (open,). The signal counts hours whose range sits inside the previous hour. The fill reads a later daily open.
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

def inside_at(
    hours: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """How many of the last 23 hours sit inside the previous hour. None on a hole."""
    if day >= end_ms:
        return None
    bars: list[tuple[float, float]] = []
    for k in range(HOURS):
        ts = day + k * HOUR_MS
        if ts >= end_ms:
            return None
        bar = hours.get(ts)
        if bar is None or len(bar) < 2:
            return None
        high, low = bar[0], bar[1]
        if high <= 0 or low <= 0 or high < low:
            return None
        bars.append((high, low))
    count = 0
    for k in range(1, HOURS):
        if bars[k][0] <= bars[k - 1][0] and bars[k][1] >= bars[k - 1][1]:
            count += 1
    return float(count)

def inside_prints(
    hours: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not hours:
        return []
    out = []
    start = min(hours) // fp5.DAY_MS * fp5.DAY_MS
    last = max(hours)
    for day in range(start, end_ms, fp5.DAY_MS):
        if day + (HOURS - 1) * HOUR_MS > last:
            continue
        value = inside_at(hours, day, end_ms)
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

def inside_signal_days(
    hours: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(inside_prints(hours, end_ms), q)


def inside_trades(
    daily: dict[int, tuple],
    hours: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after a day with unusually many inside hours. Hold one day."""
    trades = []
    for day in inside_signal_days(hours, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
