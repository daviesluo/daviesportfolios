"""The thirty-seventh search (fp37). The fill and the null are fp5's.

Nothing here reads the network or a file. A daily bar is (open, close).
The signal is BTC's close-to-close return minus ETH's on the same day.
The price ratio's level is not the signal. The fill reads a later BTC open.
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


def _ret(bars: dict[int, tuple], day: int) -> float | None:
    prev = day - fp5.DAY_MS
    today = bars.get(day)
    yday = bars.get(prev)
    if today is None or yday is None or len(today) < 2 or len(yday) < 2:
        return None
    close = today[1]
    prior = yday[1]
    if close <= 0 or prior <= 0:
        return None
    return close / prior - 1.0


def rel_at(
    btc: dict[int, tuple], eth: dict[int, tuple], day: int, end_ms: int = fp5.SCREEN_END_MS,
) -> float | None:
    """BTC's daily return minus ETH's. None when either close is missing."""
    if day >= end_ms or day - fp5.DAY_MS >= end_ms:
        return None
    btc_ret = _ret(btc, day)
    eth_ret = _ret(eth, day)
    if btc_ret is None or eth_ret is None:
        return None
    return btc_ret - eth_ret


def rel_prints(
    btc: dict[int, tuple], eth: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[tuple[int, float]]:
    if not btc or not eth:
        return []
    prints = []
    start = min(min(btc), min(eth)) // fp5.DAY_MS * fp5.DAY_MS
    for day in range(start, end_ms, fp5.DAY_MS):
        value = rel_at(btc, eth, day, end_ms)
        if value is None:
            continue
        prints.append((day, value))
    return prints


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


def rel_signal_days(
    btc: dict[int, tuple], eth: dict[int, tuple], q: float = 0.90, end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    return _upper(rel_prints(btc, eth, end_ms), q)


def rel_trades(
    btc: dict[int, tuple],
    eth: dict[int, tuple],
    q: float = 0.90,
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS,
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    """Enter the next BTC open after a day BTC outran ETH by an unusual amount. Hold one day."""
    trades = []
    for day in rel_signal_days(btc, eth, q, end_ms):
        entry = day + fp5.DAY_MS
        exit_ = entry + fp5.DAY_MS
        trade = fp5._trade(
            "BTCUSDT", entry, exit_, btc, fee=fee, start_ms=start_ms, end_ms=end_ms,
        )
        if trade is not None:
            trades.append(trade)
    return trades
