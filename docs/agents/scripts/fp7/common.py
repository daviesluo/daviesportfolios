"""Rules for the seventh search (fp7), Binance spot, signals from public series.

The fill and the null are fp5's. Nothing here reads the network or a file.
"""

from __future__ import annotations

import importlib.util
from decimal import Decimal
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "fp5_common",
    Path(__file__).resolve().parents[1] / "fp5" / "common.py",
)
fp5 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(fp5)

MIN_N = 30
MVRV_LINE = Decimal("1")


def forward(daily: dict[int, tuple], signal_days: list[int]) -> list[dict]:
    trades = []
    for day in signal_days:
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade("BTCUSDT", entry, exit_, daily)
        if trade is not None:
            trades.append(trade)
    return trades


def mvrv_days(points: list[tuple[int, float]]) -> list[int]:
    """Strictly under the published line of 1."""
    out = []
    for day, value in points:
        if Decimal(str(value)) < MVRV_LINE:
            out.append(day)
    return out


def upper_tail_days(points: list[tuple[int, float]]) -> list[int]:
    """Strictly above the trailing-90-day 90th. The lower tail is not returned."""
    points = sorted(points)
    out = []
    for i, (day, value) in enumerate(points):
        hist = [
            points[j][1]
            for j in range(i)
            if day - 90 * fp5.DAY_MS <= points[j][0] < day
        ]
        thr = fp5.rank_threshold(hist, 0.90, 90)
        if thr is None or not value > thr:
            continue
        out.append(day)
    return out


def btc_share_days(btc: dict[int, tuple], eth: dict[int, tuple]) -> list[int]:
    """BTC's share of the two books' quote volume, above its own trailing 90th."""
    days = sorted(set(btc) & set(eth))
    shares: dict[int, float] = {}
    for day in days:
        bv, ev = btc[day][4], eth[day][4]
        if bv < 0 or ev < 0 or bv + ev <= 0:
            continue
        shares[day] = bv / (bv + ev)
    ordered = sorted(shares)
    out = []
    for i, day in enumerate(ordered):
        hist = [
            shares[prev]
            for prev in ordered[:i]
            if day - 90 * fp5.DAY_MS <= prev < day
        ]
        thr = fp5.rank_threshold(hist, 0.90, 90)
        if thr is None or not shares[day] > thr:
            continue
        out.append(day)
    return out
