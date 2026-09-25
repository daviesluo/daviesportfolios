"""The twenty-eighth search (fp28). The fill and the null are fp5's.

Nothing here reads the network or a file. An hourly bar is
(open, close, quote volume). A daily bar is (open,). The signal is the
population correlation, inside one UTC day, of those quote volumes and the
absolute close-to-open returns. The fill reads a later daily open.
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


def _corr(xs: list[float], ys: list[float]) -> float | None:
    """Population correlation. None when a series does not vary."""
    n = len(xs)
    if n < 2 or n != len(ys):
        return None
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    var_x = sum((x - mean_x) ** 2 for x in xs) / n
    var_y = sum((y - mean_y) ** 2 for y in ys) / n
    if var_x <= 0.0 or var_y <= 0.0:
        return None
    cov = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / n
    return cov / (var_x * var_y) ** 0.5


def impact_at(
    hours: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """Correlation of quote volume and absolute hourly return. None on a hole.

    A day on or after `end_ms` is not a point. An hour opened on or after
    `end_ms` is not read. The screen's end is 2024-01-01.
    """
    if day >= end_ms:
        return None
    volumes: list[float] = []
    moves: list[float] = []
    for k in range(HOURS):
        ts = day + k * HOUR_MS
        if ts >= end_ms:
            return None
        bar = hours.get(ts)
        if bar is None or len(bar) < 3:
            return None
        open_ = bar[0]
        close = bar[1]
        quote = bar[2]
        if open_ <= 0 or close <= 0 or quote < 0:
            return None
        volumes.append(quote)
        moves.append(abs(close / open_ - 1.0))
    return _corr(volumes, moves)


def impact_prints(
    hours: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    """(day, correlation). Days on or after `end_ms` are not points."""
    if not hours:
        return []
    prints = []
    start = min(hours) // fp5.DAY_MS * fp5.DAY_MS
    last = max(hours)
    for day in range(start, end_ms, fp5.DAY_MS):
        if day + (HOURS - 1) * HOUR_MS > last:
            continue
        value = impact_at(hours, day, end_ms)
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


def impact_signal_days(
    hours: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(impact_prints(hours, end_ms), q)


def impact_trades(
    daily: dict[int, tuple],
    hours: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after a day whose volume and moves lined up. Hold one day."""
    trades = []
    for day in impact_signal_days(hours, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
