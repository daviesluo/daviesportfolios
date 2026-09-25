"""The thirty-fifth search (fp35). The fill and the null are fp5's.

Nothing here reads the network or a file. A daily bar is (open, base volume,
quote volume). The signal is today's open divided by yesterday's VWAP, minus
1. VWAP is quote volume divided by base volume. Today's close is not an
input. The fill reads a later daily open.
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


def vwap_at(
    daily: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """Today's open versus yesterday's VWAP, minus 1. None when volume is missing."""
    if day >= end_ms:
        return None
    prev = day - fp5.DAY_MS
    today = daily.get(day)
    yday = daily.get(prev)
    if today is None or yday is None or len(today) < 1 or len(yday) < 3:
        return None
    open_ = today[0]
    base, quote = yday[1], yday[2]
    if open_ <= 0 or base <= 0 or quote <= 0:
        return None
    return open_ / (quote / base) - 1.0


def vwap_prints(
    daily: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not daily:
        return []
    prints = []
    start = min(daily) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = vwap_at(daily, day, end_ms)
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


def vwap_signal_days(
    daily: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(vwap_prints(daily, end_ms), q)


def vwap_trades(
    daily: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after an open that cleared yesterday's VWAP by an unusual amount. Hold one day."""
    trades = []
    for day in vwap_signal_days(daily, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
