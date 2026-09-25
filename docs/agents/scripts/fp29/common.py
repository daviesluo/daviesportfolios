"""The twenty-ninth search (fp29). The fill and the null are fp5's.

Nothing here reads the network or a file. A daily bar is (open, close).
The signal is today's close divided by the highest close in the prior 30
calendar days, minus 1. The fill reads a later daily open. The bar's high
is not an input, and neither is the close from 30 days ago on its own.
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
PRIOR = 30


def peak_at(
    daily: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """Close versus the prior 30 closes' maximum, minus 1. None on a hole.

    A day on or after `end_ms` is not a point. The screen's end is 2024-01-01.
    """
    if day >= end_ms:
        return None
    bar = daily.get(day)
    if bar is None or len(bar) < 2:
        return None
    close = bar[1]
    if close <= 0:
        return None
    peak = None
    for k in range(1, PRIOR + 1):
        prev = day - k * fp5.DAY_MS
        if prev >= end_ms:
            return None
        prior = daily.get(prev)
        if prior is None or len(prior) < 2:
            return None
        pclose = prior[1]
        if pclose <= 0:
            return None
        peak = pclose if peak is None else max(peak, pclose)
    if peak is None or peak <= 0:
        return None
    return close / peak - 1.0


def peak_prints(
    daily: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    """(day, distance from the prior 30-day close high). Days on or after `end_ms` are not points."""
    if not daily:
        return []
    prints = []
    start = min(daily) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = peak_at(daily, day, end_ms)
        if value is None:
            continue
        prints.append((day, value))
    return prints


def _upper(points: list[tuple[int, float]], q: float) -> list[int]:
    """Days strictly above their own trailing-90-day quantile."""
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


def peak_signal_days(
    daily: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(peak_prints(daily, end_ms), q)


def peak_trades(
    daily: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after a close that cleared its own prior 30-day high by an unusual amount. Hold one day."""
    trades = []
    for day in peak_signal_days(daily, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
