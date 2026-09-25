"""The search fp145. The fill and the null are fp5's.

Nothing here reads the network or a file. A fill bar's first field is the
BTCUSDT open. The signal is the jump in the last taker ratio. No hourly price bar is read.
The hold is one day.
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
COIN = "BTCUSDT"
IDEA = "TAKJMP"


def signal_at(rows: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS) -> float | None:
    """Today's last taker ratio minus yesterday's. Yesterday is one day earlier."""
    if day >= end_ms:
        return None
    today = rows.get(day)
    prev = rows.get(day - fp5.DAY_MS)
    if today is None or prev is None or len(today) != 1 or len(prev) != 1:
        return None
    if today[0] <= 0 or prev[0] <= 0:
        return None
    return today[0] - prev[0]


def signal_prints(rows: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[tuple[int, float]]:
    if not rows:
        return []
    start = min(rows) // fp5.DAY_MS * fp5.DAY_MS
    out = []
    for day in range(start, end_ms, fp5.DAY_MS):
        value = signal_at(rows, day, end_ms)
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
        if thr is None or not value > thr:
            continue
        out.append(ts)
    return out


def signal_days(
    rows: dict[int, tuple],
    q: float = 0.90,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(signal_prints(rows, end_ms), q)


def signal_trades(
    rows: dict[int, tuple],
    bars: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next BTCUSDT daily open. Hold one day."""
    trades = []
    for day in signal_days(rows, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            COIN, entry, exit_, bars, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
