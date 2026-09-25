"""The nineteenth search (fp19). The fill and the null are fp5's.

Nothing here reads the network or a file. A bar is (open, high, low, close).
The signal reads the high, the low and the close. The fill reads the open.
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


def loc_at(daily: dict[int, tuple], day: int) -> float | None:
    """Where the close sits between the day's low and high. None on a flat bar, a hole, or a 2024 bar."""
    if day >= fp5.SCREEN_END_MS:
        return None
    bar = daily.get(day)
    if bar is None or len(bar) < 4:
        return None
    high = bar[1]
    low = bar[2]
    close = bar[3]
    if high <= 0 or low <= 0 or close <= 0:
        return None
    if high <= low or close < low or close > high:
        return None
    return (close - low) / (high - low)


def loc_prints(daily: dict[int, tuple]) -> list[tuple[int, float]]:
    """(day, close location). Days on or after 2024-01-01 are not points."""
    prints = []
    for day in sorted(daily):
        loc = loc_at(daily, day)
        if loc is None:
            continue
        prints.append((day, loc))
    return prints


def _upper(points: list[tuple[int, float]], q: float) -> list[int]:
    """Days strictly above their own trailing-90-day quantile. The low tail is not returned."""
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


def loc_signal_days(daily: dict[int, tuple], q: float = 0.90) -> list[int]:
    return _upper(loc_prints(daily), q)


def loc_trades(
    daily: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after a close at the top of its own range. Hold one day."""
    trades = []
    for day in loc_signal_days(daily, q):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
