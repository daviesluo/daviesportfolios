"""The thirty-sixth search (fp36). The fill and the null are fp5's.

Nothing here reads the network or a file. A daily bar is (open, high, low).
The signal is where today's open sits in yesterday's high-low range. Today's
high and low are not the signal. The fill reads a later daily open.
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


def loc_at(
    daily: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """Today's open inside yesterday's range. None when yesterday has no range."""
    if day >= end_ms:
        return None
    prev = day - fp5.DAY_MS
    today = daily.get(day)
    yday = daily.get(prev)
    if today is None or yday is None or len(today) < 1 or len(yday) < 3:
        return None
    open_ = today[0]
    high, low = yday[1], yday[2]
    if open_ <= 0 or low <= 0 or high <= 0 or high <= low:
        return None
    return (open_ - low) / (high - low)


def loc_prints(
    daily: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not daily:
        return []
    prints = []
    start = min(daily) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = loc_at(daily, day, end_ms)
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


def loc_signal_days(
    daily: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(loc_prints(daily, end_ms), q)


def loc_trades(
    daily: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after an open that sat unusually high in yesterday's range. Hold one day."""
    trades = []
    for day in loc_signal_days(daily, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
