"""The search fp162. Open interest rose on a down day, then a one-day long.

Nothing here reads the network or a file. Both have to be true: the last
dollar open interest is above the first, and the close is under the open.
Yesterday is not read. The fill is the next open to the open after that.
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
IDEA = "ACCUM"


def signal_days(
    oi: dict[int, tuple], bars: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    """Days that added inventory and closed under the open."""
    out = []
    for day in sorted(oi):
        if day >= end_ms or day not in bars:
            continue
        if len(oi[day]) != 2 or len(bars[day]) != 2:
            raise ValueError("the bar is the open and the close, and open interest is two prints")
        first, last = oi[day]
        open_px, close_px = bars[day]
        if first > 0.0 and last > first and close_px < open_px:
            out.append(day)
    return out


def signal_trades(
    oi: dict[int, tuple], bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(oi, bars, end_ms):
        entry = day + fp5.DAY_MS
        trade = fp5._trade(COIN, entry, entry + fp5.DAY_MS, bars, fee, start_ms, end_ms)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    pool = []
    day = start_ms
    while day < end_ms:
        trade = fp5._trade(COIN, day, day + fp5.DAY_MS, bars, fee, start_ms, end_ms)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
