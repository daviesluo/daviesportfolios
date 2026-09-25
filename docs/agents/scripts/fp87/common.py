"""The eighty-seventh search (fp87). The fill and the null are fp5's.

Nothing here reads the network or a file. A daily bar is
(open, high, low, close, quote, base). The open is the fill. The signal is
(close - quote/base) / (high - low).
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


def stretch_at(
    daily: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """How far the close sits above the VWAP, in units of the day's range."""
    if day >= end_ms:
        return None
    bar = daily.get(day)
    if bar is None or len(bar) < 6:
        return None
    _open, high, low, close, quote, base = bar
    if high <= low or low <= 0 or high <= 0 or close <= 0 or quote <= 0 or base <= 0:
        return None
    return (close - quote / base) / (high - low)


def stretch_prints(
    daily: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not daily:
        return []
    out = []
    start = min(daily) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = stretch_at(daily, day, end_ms)
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


def stretch_signal_days(
    daily: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(stretch_prints(daily, end_ms), q)


def stretch_trades(
    daily: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after the close finished far above the VWAP. Hold one day."""
    trades = []
    for day in stretch_signal_days(daily, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
