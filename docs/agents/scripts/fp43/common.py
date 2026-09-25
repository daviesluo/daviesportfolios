"""The forty-third search (fp43). The fill and the null are fp5's.

Nothing here reads the network or a file. An hourly bar is (open, close, quote volume). A daily bar is (open,). The signal is the share of quote volume that printed in hours whose close was above the open. The fill reads a later daily open.
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

def upvol_at(
    hours: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """Quote volume in up hours over the day's quote volume. None on a hole or an empty day."""
    if day >= end_ms:
        return None
    up = 0.0
    total = 0.0
    for k in range(HOURS):
        ts = day + k * HOUR_MS
        if ts >= end_ms:
            return None
        bar = hours.get(ts)
        if bar is None or len(bar) < 3:
            return None
        open_, close, quote = bar[0], bar[1], bar[2]
        if open_ <= 0 or close <= 0 or quote < 0:
            return None
        total += quote
        if close > open_:
            up += quote
    if total <= 0.0:
        return None
    return up / total

def upvol_prints(
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
        value = upvol_at(hours, day, end_ms)
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

def upvol_signal_days(
    hours: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(upvol_prints(hours, end_ms), q)


def upvol_trades(
    daily: dict[int, tuple],
    hours: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after a day whose quote volume sat in the up hours. Hold one day."""
    trades = []
    for day in upvol_signal_days(hours, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
