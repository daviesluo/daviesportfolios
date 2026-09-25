"""The twenty-seventh search (fp27). The fill and the null are fp5's.

Nothing here reads the network or a file. A count point is (day, addresses
with a balance). A daily bar is (open,). The signal is the day's change in
that count. The fill reads a later daily open. The level of the count is
not the statistic.
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


def _clean(points: list[tuple[int, float]]) -> dict[int, float]:
    """One count per day. A duplicate day is dropped."""
    seen: dict[int, float] = {}
    dup: set[int] = set()
    for day, count in points:
        day = int(day)
        if day in seen or day in dup:
            dup.add(day)
            seen.pop(day, None)
            continue
        seen[day] = float(count)
    return seen


def change_prints(
    points: list[tuple[int, float]], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    """(day, change in the address count). A day on or after `end_ms` is not a point.

    The previous print has to be exactly one day earlier. A non-positive count
    on either day is missing. A decrease is still a point, so it can sit in a
    later day's history. The screen's end is 2024-01-01.
    """
    seen = _clean(points)
    out = []
    for day in sorted(seen):
        if day >= end_ms:
            continue
        prev = seen.get(day - fp5.DAY_MS)
        count = seen[day]
        if prev is None or prev <= 0 or count <= 0:
            continue
        out.append((day, count - prev))
    return out


def _upper(points: list[tuple[int, float]], q: float) -> list[int]:
    """Days strictly above their own trailing-90-day quantile, and only when the change is positive."""
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


def change_signal_days(
    points: list[tuple[int, float]], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(change_prints(points, end_ms), q)


def change_trades(
    daily: dict[int, tuple],
    points: list[tuple[int, float]],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after an unusually large rise in funded addresses. Hold one day."""
    trades = []
    for day in change_signal_days(points, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
