"""The thirtieth search (fp30). The fill and the null are fp5's.

Nothing here reads the network or a file. An hourly bar is (open, close).
A daily bar is (open,). The signal counts sign changes of the hourly
close-to-open returns. A flat hour keeps the previous non-zero sign and is
not itself a turn. The fill reads a later daily open.
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


def _turns(returns: list[float]) -> int:
    last = 0
    turns = 0
    for value in returns:
        if value == 0.0:
            continue
        sign = 1 if value > 0.0 else -1
        if last != 0 and sign != last:
            turns += 1
        last = sign
    return turns


def turn_at(
    hours: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """How many times the hourly return flips sign. None on a hole or a late day."""
    if day >= end_ms:
        return None
    returns: list[float] = []
    for k in range(HOURS):
        ts = day + k * HOUR_MS
        if ts >= end_ms:
            return None
        bar = hours.get(ts)
        if bar is None or len(bar) < 2:
            return None
        open_, close = bar[0], bar[1]
        if open_ <= 0 or close <= 0:
            return None
        returns.append(close / open_ - 1.0)
    return float(_turns(returns))


def turn_prints(
    hours: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not hours:
        return []
    prints = []
    start = min(hours) // fp5.DAY_MS * fp5.DAY_MS
    last = max(hours)
    for day in range(start, end_ms, fp5.DAY_MS):
        if day + (HOURS - 1) * HOUR_MS > last:
            continue
        value = turn_at(hours, day, end_ms)
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


def turn_signal_days(
    hours: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(turn_prints(hours, end_ms), q)


def turn_trades(
    daily: dict[int, tuple],
    hours: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after a day with an unusual number of sign changes. Hold one day."""
    trades = []
    for day in turn_signal_days(hours, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
