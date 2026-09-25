"""The thirteenth search (fp13). The fill and the null are fp5's.

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


def _upper(points: list[tuple[int, float]]) -> list[int]:
    """Timestamps strictly above their own trailing-90-day 90th. The low tail is not returned."""
    points = sorted(points)
    out = []
    for i, (ts, value) in enumerate(points):
        hist = [
            points[j][1]
            for j in range(i)
            if ts - 90 * fp5.DAY_MS <= points[j][0] < ts
        ]
        thr = fp5.rank_threshold(hist, 0.90, 90)
        if thr is None or not value > thr:
            continue
        out.append(ts)
    return out


def spread_points(btc: list[tuple[int, float]], eth: list[tuple[int, float]]) -> list[tuple[int, float]]:
    """(day, ETH DVOL minus BTC DVOL). Days on or after the screen end are not points."""
    left = {int(ts): float(value) for ts, value in btc if int(ts) < fp5.SCREEN_END_MS}
    points = []
    for ts, value in eth:
        ts = int(ts)
        if ts >= fp5.SCREEN_END_MS or ts not in left:
            continue
        points.append((ts, float(value) - left[ts]))
    return sorted(points)


def spread_signal_days(btc: list[tuple[int, float]], eth: list[tuple[int, float]]) -> list[int]:
    return _upper(spread_points(btc, eth))


def spread_trades(
    daily: dict[int, tuple], btc: list[tuple[int, float]], eth: list[tuple[int, float]],
) -> list[dict]:
    """Enter the next daily open after a rich ETH-minus-BTC implied-vol gap. Hold one day."""
    return fp5.daily_forward(daily, spread_signal_days(btc, eth), 1)
