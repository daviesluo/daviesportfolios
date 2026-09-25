"""The twenty-second search (fp22). The fill and the null are fp5's.

Nothing here reads the network or a file. An hourly bar is (quote volume,).
A daily bar is (open,). The signal reads the 24 hourly quote volumes. The
fill reads a later daily open.
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


def hhi_at(hours: dict[int, tuple], day: int) -> float | None:
    """Herfindahl of the day's 24 hourly quote shares. None on a hole, a negative print, or a 2024 day."""
    if day >= fp5.SCREEN_END_MS:
        return None
    quotes = []
    for k in range(HOURS):
        bar = hours.get(day + k * HOUR_MS)
        if bar is None or len(bar) < 1:
            return None
        quote = bar[0]
        if quote < 0:
            return None
        quotes.append(quote)
    total = sum(quotes)
    if total <= 0:
        return None
    return sum((quote / total) ** 2 for quote in quotes)


def hhi_prints(hours: dict[int, tuple]) -> list[tuple[int, float]]:
    """(day, Herfindahl). Days on or after 2024-01-01 are not points."""
    days = range(min(hours) // fp5.DAY_MS * fp5.DAY_MS, fp5.SCREEN_END_MS, fp5.DAY_MS) if hours else []
    prints = []
    for day in days:
        if day + (HOURS - 1) * HOUR_MS > max(hours):
            continue
        hhi = hhi_at(hours, day)
        if hhi is None:
            continue
        prints.append((day, hhi))
    return prints


def _upper(points: list[tuple[int, float]], q: float) -> list[int]:
    """Days strictly above their own trailing-90-day quantile. An even day is not returned."""
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


def hhi_signal_days(hours: dict[int, tuple], q: float = 0.90) -> list[int]:
    return _upper(hhi_prints(hours), q)


def hhi_trades(
    daily: dict[int, tuple],
    hours: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after a day whose volume sat in few hours. Hold one day."""
    trades = []
    for day in hhi_signal_days(hours, q):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
