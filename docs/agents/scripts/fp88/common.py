"""The eighty-eighth search (fp88). The fill and the null are fp5's.

Nothing here reads the network or a file. A daily bar is (open, high, low).
The open is the fill. The signal is (today's low - yesterday's high) divided
by yesterday's high minus yesterday's low. Today's high is not an input.
The close is not stored.
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


def hold_at(
    daily: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """Today's low against yesterday's high, in units of yesterday's range."""
    if day >= end_ms:
        return None
    prev = daily.get(day - fp5.DAY_MS)
    cur = daily.get(day)
    if prev is None or cur is None or len(prev) < 3 or len(cur) < 3:
        return None
    y_high, y_low = prev[1], prev[2]
    low = cur[2]
    if y_high <= y_low or y_low <= 0 or y_high <= 0 or low <= 0:
        return None
    return (low - y_high) / (y_high - y_low)


def hold_prints(
    daily: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not daily:
        return []
    out = []
    start = min(daily) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = hold_at(daily, day, end_ms)
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


def hold_signal_days(
    daily: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(hold_prints(daily, end_ms), q)


def hold_trades(
    daily: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after the low held above yesterday's range. Hold one day."""
    trades = []
    for day in hold_signal_days(daily, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
