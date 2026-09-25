"""The twenty-fifth search (fp25). The fill and the null are fp5's.

Nothing here reads the network or a file. A stock point is (day, coins held
on exchanges). A daily bar is (open,). The signal reads the stock. The fill
reads a later daily open. A day's inflow or outflow is not an input.
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


def stock_prints(points: list[tuple[int, float]]) -> list[tuple[int, float]]:
    """(day, exchange-held coins). A 2024 stamp, a non-positive stock, or a duplicate day is not a point."""
    seen: dict[int, float] = {}
    dup: set[int] = set()
    for day, stock in points:
        day = int(day)
        if day in seen or day in dup:
            dup.add(day)
            seen.pop(day, None)
            continue
        seen[day] = float(stock)
    out = []
    for day, stock in sorted(seen.items()):
        if day >= fp5.SCREEN_END_MS or stock <= 0:
            continue
        out.append((day, stock))
    return out


def _upper(points: list[tuple[int, float]], q: float) -> list[int]:
    """Days strictly above their own trailing-90-day quantile. A thin stock is not returned."""
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


def stock_signal_days(points: list[tuple[int, float]], q: float = 0.90) -> list[int]:
    return _upper(stock_prints(points), q)


def stock_trades(
    daily: dict[int, tuple],
    points: list[tuple[int, float]],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after a day of unusually high exchange stock. Hold one day."""
    trades = []
    for day in stock_signal_days(points, q):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
