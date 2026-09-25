"""The eighteenth search (fp18). The fill and the null are fp5's.

Nothing here reads the network or a file. A bar is
(open, high, low, close, quote). The signal reads closes. The fill reads
BTC's open.
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
WINDOW = 30


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


def _returns(daily: dict[int, tuple], day: int) -> list[float] | None:
    """WINDOW simple close-to-close returns ending at `day`, oldest last. None on a hole or a bad close."""
    out = []
    for k in range(WINDOW):
        t = day - k * fp5.DAY_MS
        prev = t - fp5.DAY_MS
        bar = daily.get(t)
        old = daily.get(prev)
        if bar is None or old is None or bar[3] <= 0 or old[3] <= 0:
            return None
        out.append(bar[3] / old[3] - 1.0)
    return out


def corr_at(btc: dict[int, tuple], eth: dict[int, tuple], day: int) -> float | None:
    """30-day correlation of BTC and ETH simple returns. None on a hole, a flat window, or a 2024 bar."""
    if day >= fp5.SCREEN_END_MS:
        return None
    left = _returns(btc, day)
    right = _returns(eth, day)
    if left is None or right is None:
        return None
    return population_corr(left, right)


def corr_prints(btc: dict[int, tuple], eth: dict[int, tuple]) -> list[tuple[int, float]]:
    """(day, correlation). Days on or after 2024-01-01 are not points."""
    days = sorted(set(btc) & set(eth))
    prints = []
    for day in days:
        corr = corr_at(btc, eth, day)
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


def corr_signal_days(
    btc: dict[int, tuple], eth: dict[int, tuple], q: float = 0.90,
) -> list[int]:
    return _upper(corr_prints(btc, eth), q)


def corr_trades(
    btc: dict[int, tuple],
    eth: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next BTC daily open after the two coins locked together. Hold one day."""
    trades = []
    for day in corr_signal_days(btc, eth, q):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, btc, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
