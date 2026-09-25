"""The seventy-ninth search (fp79). The fill and the null are fp5's.

Nothing here reads the network or a file. An hourly bar is (open, close, quote). A daily bar is (open,). The signal is the return of the earliest hour whose quote volume is the day's maximum.
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


def busy_at(
    hours: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """Return of the earliest maximum-quote hour. None when an hour is missing."""
    if day >= end_ms:
        return None
    best_i = None
    best_q = None
    for i in range(HOURS):
        bar = hours.get(day + i * HOUR_MS)
        if bar is None or len(bar) < 3 or bar[0] <= 0 or bar[1] <= 0 or bar[2] < 0:
            return None
        if best_q is None or bar[2] > best_q:
            best_q = bar[2]
            best_i = i
    if best_i is None or best_q is None or best_q <= 0:
        return None
    chosen = hours[day + best_i * HOUR_MS]
    return chosen[1] / chosen[0] - 1.0

def busy_prints(
    hours: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not hours:
        return []
    out = []
    start = min(hours) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = busy_at(hours, day, end_ms)
        if value is None:
            continue
        out.append((day, value))
    return out


def busy_signal_days(
    hours: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(busy_prints(hours, end_ms), q)

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

def busy_trades(
    daily: dict[int, tuple], hours: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after the busiest hour rose. Hold one day."""
    trades = []
    for day in busy_signal_days(hours, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
