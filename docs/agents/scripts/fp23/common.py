"""The twenty-third search (fp23). The fill and the null are fp5's.

Nothing here reads the network or a file. An hourly bar is (open, close).
A daily bar is (open,). The signal reads each hour's own open and close.
The fill reads a later daily open.
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


def share_at(hours: dict[int, tuple], day: int) -> float | None:
    """Share of the day's hours that closed strictly above their own open. None on a hole or a 2024 day."""
    if day >= fp5.SCREEN_END_MS:
        return None
    ups = 0
    for k in range(HOURS):
        bar = hours.get(day + k * HOUR_MS)
        if bar is None or len(bar) < 2:
            return None
        open_ = bar[0]
        close = bar[1]
        if open_ <= 0 or close <= 0:
            return None
        if close > open_:
            ups += 1
    return ups / HOURS


def share_prints(hours: dict[int, tuple]) -> list[tuple[int, float]]:
    """(day, up-hour share). Days on or after 2024-01-01 are not points."""
    if not hours:
        return []
    prints = []
    start = min(hours) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, fp5.SCREEN_END_MS, fp5.DAY_MS):
        if day + (HOURS - 1) * HOUR_MS > max(hours):
            continue
        share = share_at(hours, day)
        if share is None:
            continue
        prints.append((day, share))
    return prints


def _upper(points: list[tuple[int, float]], q: float) -> list[int]:
    """Days strictly above their own trailing-90-day quantile. A down day is not returned."""
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


def share_signal_days(hours: dict[int, tuple], q: float = 0.90) -> list[int]:
    return _upper(share_prints(hours), q)


def share_trades(
    daily: dict[int, tuple],
    hours: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after a day of unusually many up hours. Hold one day."""
    trades = []
    for day in share_signal_days(hours, q):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
