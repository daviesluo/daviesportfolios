"""The search fp174. A wider range than six days ago, held two days.

Nothing here reads the network or a file. Six days is the horizon. Today's
high minus today's low is strictly wider than that earlier range. The
comparison is not yesterday and it is not a percentile. The next day buys
the open and sells the open two days later.
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
IDEA = "LAG6"
HORIZON = 6
HOLD_DAYS = 2


def _range(bar: tuple) -> float:
    return bar[1] - bar[2]


def signal_days(bars: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days whose range is strictly wider than the range six days earlier."""
    out = []
    for day in sorted(bars):
        old = day - HORIZON * fp5.DAY_MS
        if day >= end_ms or old not in bars:
            continue
        if len(bars[day]) != 4 or len(bars[old]) != 4:
            raise ValueError("a bar is the open, the high, the low and the close")
        if bars[day][1] < bars[day][2] or bars[old][1] < bars[old][2]:
            continue
        if _range(bars[day]) > _range(bars[old]):
            out.append(day)
    return out


def _hold(bars: dict[int, tuple], entry: int, fee: float):
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if entry not in bars or exit_ms not in bars:
        return None
    entry_px = bars[entry][0]
    exit_px = bars[exit_ms][0]
    net = fp5.net_return(entry_px, exit_px, fee)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": exit_px / entry_px - 1.0,
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
        trade = _hold(bars, entry, fee)
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
        trade = _hold(bars, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
