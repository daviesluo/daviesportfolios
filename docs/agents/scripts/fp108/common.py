"""The search fp108. The fill and the null are fp5's.

Nothing here reads the network or a file. A daily bar is (open,). The open
is the fill on BTCUSDT. The signal is the range of that UTC day's three
BTC funding prints. The funding level is not an input. No hourly price bar
is read. No alt quote is read. The hold is 7 days, fixed in this file.
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
HOLD_DAYS = 7
COIN = "BTCUSDT"
IDEA = "FRNG-7"
# Last exit open this screen may store. 2024-01-14. Not a signal day.
EXIT_HORIZON_MS = fp5.SCREEN_END_MS + 13 * fp5.DAY_MS


def frng_at(
    funding: dict[int, float],
    day: int,
    end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """High funding print minus the low one. None unless the day has exactly three."""
    if day >= end_ms or day % fp5.DAY_MS != 0:
        return None
    wanted = (
        day,
        day + fp5.EIGHT_H_MS,
        day + 2 * fp5.EIGHT_H_MS,
    )
    rates = []
    for ts in wanted:
        if ts not in funding:
            return None
        rates.append(funding[ts])
    for ts in funding:
        if day <= ts < day + fp5.DAY_MS and ts not in wanted:
            return None
    return max(rates) - min(rates)


def frng_prints(
    funding: dict[int, float],
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not funding:
        return []
    start = min(funding) // fp5.DAY_MS * fp5.DAY_MS
    out = []
    for day in range(start, end_ms, fp5.DAY_MS):
        value = frng_at(funding, day, end_ms)
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


def frng_signal_days(
    funding: dict[int, float],
    q: float = 0.90,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(frng_prints(funding, end_ms), q)


def frng_trades(
    funding: dict[int, float],
    bars: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next BTC daily open. Hold 7 days. The open is not an input."""
    trades = []
    for day in frng_signal_days(funding, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + HOLD_DAYS * fp5.DAY_MS
        trade = fp5._trade(
            COIN, entry, exit_, bars, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
