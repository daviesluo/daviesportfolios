"""The search fp158. An up day, then a long with a two-percent stop.

Nothing here reads the network or a file. The signal is the sign of the
candle, close above open. The next day is long from the open. If that day's
low is at or under 2% below the open, the exit is that stop. Otherwise the
exit is the next open. Two percent is the rule, not a fitted width.
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
IDEA = "UPSTOP"
STOP = 0.02


def signal_days(bars: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days whose close is strictly above the open."""
    out = []
    for day in sorted(bars):
        if day >= end_ms:
            continue
        row = bars[day]
        if len(row) != 3:
            raise ValueError("a bar is the open, the low and the close")
        if row[2] > row[0]:
            out.append(day)
    return out


def _stopped(bars: dict[int, tuple], entry: int, fee: float):
    exit_ms = entry + fp5.DAY_MS
    if entry not in bars or exit_ms not in bars:
        return None
    if len(bars[entry]) != 3 or len(bars[exit_ms]) < 1:
        raise ValueError("a hold bar is the open, the low and the close")
    entry_open = bars[entry][0]
    low = bars[entry][1]
    stop_px = entry_open * (1.0 - STOP)
    if low <= stop_px:
        exit_px = stop_px
    else:
        exit_px = bars[exit_ms][0]
    gross = exit_px / entry_open - 1.0
    net = fp5.net_return(entry_open, exit_px, fee)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
        "stopped": low <= stop_px,
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
        trade = _stopped(bars, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """The same stop, on every in-screen day, whether or not the prior day was up."""
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _stopped(bars, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
