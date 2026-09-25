"""Rules for the tenth search (fp10). The fill and the null are fp5's.

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


def eth_lead_prints(eth: dict[int, tuple]) -> list[tuple[int, float]]:
    """(t+8h, ETH close-to-close return on the bar that opened at t)."""
    prints = []
    for t in sorted(eth):
        if t >= fp5.SCREEN_END_MS:
            continue
        prev = t - fp5.EIGHT_H_MS
        if prev not in eth:
            continue
        old = eth[prev][3]
        new = eth[t][3]
        if old <= 0 or new <= 0:
            continue
        prints.append((t + fp5.EIGHT_H_MS, new / old - 1.0))
    return prints


def eth_lead_entries(eth: dict[int, tuple]) -> list[int]:
    return _upper(eth_lead_prints(eth))


def eth_lead_trades(eth: dict[int, tuple], btc: dict[int, tuple]) -> list[dict]:
    """Enter BTC when ETH's last 8h bar was rich. Hold one 8h bar. ETH is not held."""
    trades = []
    for entry in eth_lead_entries(eth):
        trade = fp5._trade("BTCUSDT", entry, entry + fp5.EIGHT_H_MS, btc)
        if trade is not None:
            trades.append(trade)
    return trades


def tvl_changes(points: list[tuple[int, float]]) -> list[tuple[int, float]]:
    """(day, tvl[day] / tvl[day−1] − 1). Stamps on or after the screen end are dropped."""
    book = {}
    for ts, value in points:
        ts = int(ts)
        value = float(value)
        if ts >= fp5.SCREEN_END_MS or value <= 0:
            continue
        book[ts] = value
    changes = []
    for day in sorted(book):
        prev = day - fp5.DAY_MS
        if prev not in book:
            continue
        changes.append((day, book[day] / book[prev] - 1.0))
    return changes


def tvl_signal_days(points: list[tuple[int, float]]) -> list[int]:
    return _upper(tvl_changes(points))


def tvl_trades(daily: dict[int, tuple], points: list[tuple[int, float]]) -> list[dict]:
    """Enter the next daily open after a rich TVL change. Hold one day."""
    return fp5.daily_forward(daily, tvl_signal_days(points), 1)
