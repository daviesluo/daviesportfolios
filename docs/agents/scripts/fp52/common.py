"""The fifty-second search (fp52). The fill and the null are fp5's.

Nothing here reads the network or a file. A daily bar is (open, quote). The
signal is today's quote volume divided by yesterday's, minus 1. A day that
did not grow stays in the history and is not a signal. The level of the
quote volume is not the signal. The trade count does not enter. The fill
reads a later daily open.
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


def qvol_at(
    daily: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """Change in quote volume versus the previous day. None when a quote is missing."""
    if day >= end_ms:
        return None
    today = daily.get(day)
    yday = daily.get(day - fp5.DAY_MS)
    if today is None or yday is None or len(today) < 2 or len(yday) < 2:
        return None
    quote, prior = today[1], yday[1]
    if quote <= 0 or prior <= 0:
        return None
    return quote / prior - 1.0


def qvol_prints(
    daily: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not daily:
        return []
    out = []
    start = min(daily) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = qvol_at(daily, day, end_ms)
        if value is None:
            continue
        out.append((day, value))
    return out


def _upper(points: list[tuple[int, float]], q: float) -> list[int]:
    """Days strictly above their own trailing quantile, and only when quote rose."""
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


def qvol_signal_days(
    daily: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(qvol_prints(daily, end_ms), q)


def qvol_trades(
    daily: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after an unusual rise in quote volume. Hold one day."""
    trades = []
    for day in qvol_signal_days(daily, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
