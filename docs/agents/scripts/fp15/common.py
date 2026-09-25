"""The fifteenth search (fp15). The fill and the null are fp5's.

Nothing here reads the network or a file.
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
SHORT_DAYS = 7
LONG_DAYS = 30


def population_stdev(values: list[float]) -> float | None:
    """Square root of the second moment about the mean. Divides by n. None if that moment is zero."""
    n = len(values)
    if n < 1:
        return None
    mean = sum(values) / n
    m2 = sum((x - mean) ** 2 for x in values) / n
    if m2 == 0.0:
        return None
    return m2 ** 0.5


def _window(daily: dict[int, tuple], day: int, n: int) -> list[float] | None:
    """n simple close-to-close returns ending at `day`. None when the grid has a hole or a non-positive close."""
    out = []
    for k in range(n):
        t = day - k * fp5.DAY_MS
        prev = t - fp5.DAY_MS
        bar = daily.get(t)
        old = daily.get(prev)
        if bar is None or old is None or bar[3] <= 0 or old[3] <= 0:
            return None
        out.append(bar[3] / old[3] - 1.0)
    return out


def ratio_at(daily: dict[int, tuple], day: int) -> float | None:
    """Short-window population vol divided by the long one. None on a hole, a flat window, or a 2024 bar."""
    if day >= fp5.SCREEN_END_MS:
        return None
    short = _window(daily, day, SHORT_DAYS)
    long = _window(daily, day, LONG_DAYS)
    if short is None or long is None:
        return None
    short_vol = population_stdev(short)
    long_vol = population_stdev(long)
    if short_vol is None or long_vol is None:
        return None
    return short_vol / long_vol


def ratio_prints(daily: dict[int, tuple]) -> list[tuple[int, float]]:
    """(day, vol ratio). The day is the last close in both windows. 2024 bars are not points."""
    prints = []
    for day in sorted(daily):
        ratio = ratio_at(daily, day)
        if ratio is None:
            continue
        prints.append((day, ratio))
    return prints


def _upper(points: list[tuple[int, float]], q: float) -> list[int]:
    """Days strictly above their own trailing-90-day quantile. The low tail is not returned."""
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


def ratio_signal_days(daily: dict[int, tuple], q: float = 0.90) -> list[int]:
    return _upper(ratio_prints(daily), q)


def ratio_trades(
    daily: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after a rich short-versus-long vol ratio. Hold one day."""
    trades = []
    for day in ratio_signal_days(daily, q):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
