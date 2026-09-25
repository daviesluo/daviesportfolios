"""The forty-first search (fp41). The fill and the null are fp5's.

Nothing here reads the network or a file. A daily bar is (open, close). The signal is how many consecutive daily closes, ending today, each finished above the prior close. A day that did not rise scores 0 and stays in the history. The open is not the signal. The fill reads a later daily open.
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

def streak_at(
    daily: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """Consecutive rising closes ending today. None when today or yesterday is missing."""
    if day >= end_ms:
        return None
    streak = 0
    cursor = day
    while True:
        prev = cursor - fp5.DAY_MS
        cur = daily.get(cursor)
        old = daily.get(prev)
        if cur is None or old is None or len(cur) < 2 or len(old) < 2:
            if streak == 0 and cursor == day:
                return None
            return float(streak)
        close, prior = cur[1], old[1]
        if close <= 0 or prior <= 0:
            return None
        if not close > prior:
            return float(streak)
        streak += 1
        cursor = prev



def streak_prints(
    daily: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not daily:
        return []
    out = []
    start = min(daily) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = streak_at(daily, day, end_ms)
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
        if thr is None or not value > thr or not value > 0:
            continue
        out.append(ts)
    return out

def streak_signal_days(
    daily: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(streak_prints(daily, end_ms), q)


def streak_trades(
    daily: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after an unusually long run of rising closes. Hold one day."""
    trades = []
    for day in streak_signal_days(daily, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
