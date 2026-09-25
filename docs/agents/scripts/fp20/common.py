"""The twentieth search (fp20). The fill and the null are fp5's.

Nothing here reads the network or a file. A bar is (open, close). The
signal reads this open and the previous close. The fill reads a later open.
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


def gap_at(daily: dict[int, tuple], day: int) -> float | None:
    """Open divided by the previous close, minus 1. None on a hole, a bad price, or a 2024 bar."""
    if day >= fp5.SCREEN_END_MS:
        return None
    bar = daily.get(day)
    prev = daily.get(day - fp5.DAY_MS)
    if bar is None or prev is None or len(bar) < 2 or len(prev) < 2:
        return None
    open_ = bar[0]
    prev_close = prev[1]
    if open_ <= 0 or prev_close <= 0:
        return None
    return open_ / prev_close - 1.0


def gap_prints(daily: dict[int, tuple]) -> list[tuple[int, float]]:
    """(day, overnight gap). Days on or after 2024-01-01 are not points."""
    prints = []
    for day in sorted(daily):
        gap = gap_at(daily, day)
        if gap is None:
            continue
        prints.append((day, gap))
    return prints


def _upper(points: list[tuple[int, float]], q: float) -> list[int]:
    """Days strictly above their own trailing-90-day quantile. The gap down is not returned."""
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


def gap_signal_days(daily: dict[int, tuple], q: float = 0.90) -> list[int]:
    return _upper(gap_prints(daily), q)


def gap_trades(
    daily: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the daily open after the one the gap was read from. Hold one day."""
    trades = []
    for day in gap_signal_days(daily, q):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
