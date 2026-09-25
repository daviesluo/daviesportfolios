"""The fourteenth search (fp14). The fill and the null are fp5's.

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
MIN_COINS = 10


def population_skew(returns: list[float]) -> float | None:
    """m3 / m2**1.5. Both moments divide by n. None when the variance is zero."""
    n = len(returns)
    if n < 1:
        return None
    mean = sum(returns) / n
    m2 = sum((x - mean) ** 2 for x in returns) / n
    if m2 == 0.0:
        return None
    m3 = sum((x - mean) ** 3 for x in returns) / n
    return m3 / (m2 ** 1.5)


def _upper(points: list[tuple[int, float]], q: float = 0.90) -> list[int]:
    """Timestamps strictly above their own trailing-90-day quantile. The low tail is not returned."""
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


def skew_prints(
    bars_by_coin: dict[str, dict[int, tuple]], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    """(t+8h, population skewness of basket close-to-close returns on the bar that opened at t)."""
    times = set()
    for coin in fp5.BASKET:
        times.update(bars_by_coin.get(coin) or {})
    prints = []
    for t in sorted(times):
        if t >= end_ms:
            continue
        prev = t - fp5.EIGHT_H_MS
        returns = []
        for coin in fp5.BASKET:
            bars = bars_by_coin.get(coin) or {}
            if t not in bars or prev not in bars:
                continue
            old = bars[prev][3]
            new = bars[t][3]
            if old <= 0 or new <= 0:
                continue
            returns.append(new / old - 1.0)
        if len(returns) < MIN_COINS:
            continue
        skew = population_skew(returns)
        if skew is None:
            continue
        prints.append((t + fp5.EIGHT_H_MS, skew))
    return prints


def skew_entries(
    bars_by_coin: dict[str, dict[int, tuple]],
    q: float = 0.90,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(skew_prints(bars_by_coin, end_ms), q)


def skew_trades(
    bars_by_coin: dict[str, dict[int, tuple]],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter spot BTC when the basket's last 8h skewness was rich. Hold one 8h bar."""
    btc = bars_by_coin.get("BTCUSDT") or {}
    trades = []
    for entry in skew_entries(bars_by_coin, q, end_ms):
        trade = fp5._trade(
            "BTCUSDT", entry, entry + fp5.EIGHT_H_MS, btc,
            fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
