"""Rules for the ninth search (fp9). The fill and the null are fp5's.

Nothing here reads the network or a file.
"""

from __future__ import annotations

import importlib.util
import math
import statistics
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "fp5_common",
    Path(__file__).resolve().parents[1] / "fp5" / "common.py",
)
fp5 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(fp5)

MIN_N = 30
MIN_COINS = 10
REALIZED_DAYS = 30


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


def _realized_points(daily: dict[int, tuple], day: int) -> float | None:
    """Sample vol of 30 exact-grid daily log returns, in DVOL points. None if a close is missing."""
    closes = []
    for k in range(REALIZED_DAYS + 1):
        bar = daily.get(day - k * fp5.DAY_MS)
        if bar is None or bar[3] <= 0:
            return None
        closes.append(bar[3])
    returns = [math.log(closes[k] / closes[k + 1]) for k in range(REALIZED_DAYS)]
    return statistics.stdev(returns) * math.sqrt(365.0) * 100.0


def vrp_points(daily: dict[int, tuple], dvol: list[tuple[int, float]]) -> list[tuple[int, float]]:
    """(signal day, DVOL minus realized). Days on or after the screen end are not points."""
    implied = {int(ts): float(value) for ts, value in dvol}
    points = []
    for day in sorted(implied):
        if day >= fp5.SCREEN_END_MS:
            continue
        realized = _realized_points(daily, day)
        if realized is None:
            continue
        points.append((day, implied[day] - realized))
    return points


def vrp_signal_days(daily: dict[int, tuple], dvol: list[tuple[int, float]]) -> list[int]:
    return _upper(vrp_points(daily, dvol))


def vrp_trades(daily: dict[int, tuple], dvol: list[tuple[int, float]]) -> list[dict]:
    """Enter the next daily open after a rich gap. Hold one day."""
    return fp5.daily_forward(daily, vrp_signal_days(daily, dvol), 1)


def dispersion_prints(bars_by_coin: dict[str, dict[int, tuple]]) -> list[tuple[int, float]]:
    """(t+8h, population stdev of basket close-to-close returns on the bar that opened at t)."""
    times = set()
    for coin in fp5.BASKET:
        times.update((bars_by_coin.get(coin) or {}))
    prints = []
    for t in sorted(times):
        if t >= fp5.SCREEN_END_MS:
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
        prints.append((t + fp5.EIGHT_H_MS, statistics.pstdev(returns)))
    return prints


def dispersion_entries(bars_by_coin: dict[str, dict[int, tuple]]) -> list[int]:
    return _upper(dispersion_prints(bars_by_coin))


def dispersion_trades(bars_by_coin: dict[str, dict[int, tuple]]) -> list[dict]:
    """Enter BTC at the print time. Hold one 8h bar."""
    btc = bars_by_coin.get("BTCUSDT") or {}
    trades = []
    for entry in dispersion_entries(bars_by_coin):
        trade = fp5._trade("BTCUSDT", entry, entry + fp5.EIGHT_H_MS, btc)
        if trade is not None:
            trades.append(trade)
    return trades
