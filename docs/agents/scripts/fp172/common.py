"""The search fp172. A down day, then a long with a stop at that day's low.

Nothing here reads the network or a file. The close is strictly under the
open. That low is known when the day closes. The next day buys the open.
If the open is already at or under that low, the exit is the open. If the
low later trades at or under that low, the exit is that low. Otherwise the
exit is the close. The entry day's high is not read.
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
IDEA = "STOPLOW"


def signal_days(bars: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days that closed strictly under their open."""
    out = []
    for day in sorted(bars):
        if day >= end_ms or day not in bars:
            continue
        if len(bars[day]) != 4:
            raise ValueError("a bar is the open, the high, the low and the close")
        if bars[day][3] < bars[day][0]:
            out.append(day)
    return out


def _stop(bars: dict[int, tuple], entry: int, fee: float):
    prev = entry - fp5.DAY_MS
    if entry not in bars or prev not in bars:
        return None
    if len(bars[entry]) != 4:
        raise ValueError("a bar is the open, the high, the low and the close")
    level = bars[prev][2]
    open_px, _high, low, close_px = bars[entry]
    if open_px <= level:
        exit_px = open_px
    elif low <= level:
        exit_px = level
    else:
        exit_px = close_px
    net = fp5.net_return(open_px, exit_px, fee)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": entry,
        "gross": exit_px / open_px - 1.0,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_trades(
    bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(bars, end_ms):
        entry = day + fp5.DAY_MS
        if not (start_ms <= entry < end_ms):
            continue
        trade = _stop(bars, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """The same stop, on every in-screen day, down day or not."""
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _stop(bars, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
