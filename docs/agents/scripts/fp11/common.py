"""The eleventh search (fp11). The fill and the null are fp5's.

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


def depth_imbalance(rows: list[tuple[int, int, float]]) -> list[tuple[int, float]]:
    """(window end, bid-notional minus ask-notional, over their sum) at ±1% only."""
    buckets: dict[int, dict[int, tuple[int, float]]] = {}
    for ts, pct, notional in rows:
        ts = int(ts)
        pct = int(pct)
        notional = float(notional)
        if ts >= fp5.SCREEN_END_MS or pct not in (-1, 1):
            continue
        start = ts - (ts % fp5.EIGHT_H_MS)
        side = buckets.setdefault(start, {})
        prev = side.get(pct)
        if prev is None or ts >= prev[0]:
            side[pct] = (ts, notional)
    points = []
    for start, side in sorted(buckets.items()):
        if -1 not in side or 1 not in side:
            continue
        bid = side[-1][1]
        ask = side[1][1]
        if bid <= 0 or ask <= 0:
            continue
        points.append((start + fp5.EIGHT_H_MS, (bid - ask) / (bid + ask)))
    return points


def depth_entries(rows: list[tuple[int, int, float]]) -> list[int]:
    return _upper(depth_imbalance(rows))


def depth_trades(rows: list[tuple[int, int, float]], btc: dict[int, tuple]) -> list[dict]:
    """Enter spot when the perp's 1% book was bid-heavy. Hold one 8h bar."""
    trades = []
    for entry in depth_entries(rows):
        trade = fp5._trade("BTCUSDT", entry, entry + fp5.EIGHT_H_MS, btc)
        if trade is not None:
            trades.append(trade)
    return trades
