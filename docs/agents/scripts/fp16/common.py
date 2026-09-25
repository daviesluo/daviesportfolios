"""The sixteenth search (fp16). The fill and the null are fp5's.

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
HOURS = 24
HOUR_MS = fp5.DAY_MS // HOURS


def population_corr(x: list[float], y: list[float]) -> float | None:
    """Pearson correlation. Both variances and the covariance divide by n. None if either variance is zero."""
    n = len(x)
    if n < 2 or len(y) != n:
        return None
    mx = sum(x) / n
    my = sum(y) / n
    dx = [a - mx for a in x]
    dy = [b - my for b in y]
    vx = sum(d * d for d in dx) / n
    vy = sum(d * d for d in dy) / n
    if vx == 0.0 or vy == 0.0:
        return None
    cov = sum(a * b for a, b in zip(dx, dy)) / n
    return cov / ((vx ** 0.5) * (vy ** 0.5))


def day_returns(hourly: dict[int, tuple], day: int) -> list[float] | None:
    """24 close/open returns for the UTC day. None on a hole, a bad price, or a 2024 open."""
    if day >= fp5.SCREEN_END_MS or day % fp5.DAY_MS != 0:
        return None
    out = []
    for i in range(HOURS):
        t = day + i * HOUR_MS
        if t >= fp5.SCREEN_END_MS:
            return None
        bar = hourly.get(t)
        if bar is None or bar[0] <= 0 or bar[3] <= 0:
            return None
        out.append(bar[3] / bar[0] - 1.0)
    return out


def corr_at(hourly: dict[int, tuple], day: int) -> float | None:
    """Lag-1 correlation of the day's 24 hourly returns. None when the day is not a print."""
    rets = day_returns(hourly, day)
    if rets is None:
        return None
    return population_corr(rets[:-1], rets[1:])


def corr_prints(hourly: dict[int, tuple]) -> list[tuple[int, float]]:
    """(day, lag-1 correlation). Days on or after 2024-01-01 are not points."""
    days = sorted({t - (t % fp5.DAY_MS) for t in hourly if t < fp5.SCREEN_END_MS})
    prints = []
    for day in days:
        corr = corr_at(hourly, day)
        if corr is None:
            continue
        prints.append((day, corr))
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


def corr_signal_days(hourly: dict[int, tuple], q: float = 0.90) -> list[int]:
    return _upper(corr_prints(hourly), q)


def corr_trades(
    hourly: dict[int, tuple],
    daily: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after a day whose hours trended. Hold one day."""
    trades = []
    for day in corr_signal_days(hourly, q):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
