"""The twenty-fourth search (fp24). The fill and the null are fp5's.

Nothing here reads the network or a file. A fee point is (day, total native
fees). A daily bar is (open,). The signal reads the fee. The fill reads a
later daily open.
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


def fee_prints(points: list[tuple[int, float]]) -> list[tuple[int, float]]:
    """(day, total native fees). A 2024 stamp, a non-positive fee, or a duplicate day is not a point."""
    seen: dict[int, float] = {}
    dup: set[int] = set()
    for day, fee in points:
        day = int(day)
        if day in seen or day in dup:
            dup.add(day)
            seen.pop(day, None)
            continue
        seen[day] = float(fee)
    out = []
    for day, fee in sorted(seen.items()):
        if day >= fp5.SCREEN_END_MS or fee <= 0:
            continue
        out.append((day, fee))
    return out


def _upper(points: list[tuple[int, float]], q: float) -> list[int]:
    """Days strictly above their own trailing-90-day quantile. A cheap day is not returned."""
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


def fee_signal_days(points: list[tuple[int, float]], q: float = 0.90) -> list[int]:
    return _upper(fee_prints(points), q)


def fee_trades(
    daily: dict[int, tuple],
    points: list[tuple[int, float]],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next daily open after a day of unusually high total fees. Hold one day."""
    trades = []
    for day in fee_signal_days(points, q):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, daily, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
