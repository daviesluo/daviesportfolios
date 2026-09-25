"""The forty-eighth search (fp48). The fill and the null are fp5's.

Nothing here reads the network or a file. A daily bar is (open, quote, trades).
The signal is today's average trade size divided by yesterday's, minus 1.
Average size is quote volume divided by the trade count. A day that did not
grow stays in the history and is not a signal. The level of the size is not
the signal. The trade count by itself is not the signal. The fill reads a
later daily open.
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


def size_at(
    daily: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """Change in quote per trade versus the previous day. None when a size is missing."""
    if day >= end_ms:
        return None
    today = daily.get(day)
    yday = daily.get(day - fp5.DAY_MS)
    if today is None or yday is None or len(today) < 3 or len(yday) < 3:
        return None
    quote, count = today[1], today[2]
    prior_quote, prior_count = yday[1], yday[2]
    if quote <= 0 or count <= 0 or prior_quote <= 0 or prior_count <= 0:
        return None
    return (quote / count) / (prior_quote / prior_count) - 1.0


def size_prints(
    daily: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not daily:
        return []
    out = []
    start = min(daily) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = size_at(daily, day, end_ms)
        if value is None:
            continue
        out.append((day, value))
    return out


def _upper(points: list[tuple[int, float]], q: float) -> list[int]:
    """Days strictly above their own trailing quantile, and only when size rose."""
    points = sorted(points)
    out = []
    for i, (ts, value) in enumerate(points):
        hist = [
            points[j][1]
            for j in range(i)
            if ts - 90 * fp5.DAY_MS <= points[j][0] < ts
        ]
        thr = fp5.rank_threshold(hist, q, 90)
        if thr is None or not value > thr or not value > 0:
            continue
        out.append(ts)
    return out


def size_signal_days(
    daily: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(size_prints(daily, end_ms), q)


def size_trades(
    daily: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after an unusual rise in average trade size. Hold one day."""
    trades = []
    for day in size_signal_days(daily, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
