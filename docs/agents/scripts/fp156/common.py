"""The search fp156. Long the overnight after open interest rose through the day.

Nothing here reads the network or a file. The cut is the last dollar open
interest against the first print of the same day. Yesterday is not read.
The fill buys that day's close and sells the next open.
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
IDEA = "OINIGHT"


def signal_days(oi: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days whose last dollar open interest is strictly above the first."""
    out = []
    for day in sorted(oi):
        if not (0 <= day < end_ms):
            continue
        row = oi[day]
        if len(row) != 2:
            raise ValueError("open interest is the first print and the last")
        first, last = row
        if first > 0.0 and last > first:
            out.append(day)
    return out


def _overnight(bars: dict[int, tuple], day: int, fee: float):
    exit_ms = day + fp5.DAY_MS
    if day not in bars or exit_ms not in bars:
        return None
    if len(bars[day]) != 2 or len(bars[exit_ms]) != 2:
        raise ValueError("a bar is the open and the close")
    entry_px = bars[day][1]
    exit_px = bars[exit_ms][0]
    gross = exit_px / entry_px - 1.0
    net = fp5.net_return(entry_px, exit_px, fee)
    return {
        "coin": COIN,
        "entry_ms": day,
        "exit_ms": exit_ms,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_trades(
    oi: dict[int, tuple], bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(oi, end_ms):
        if not (start_ms <= day < end_ms):
            continue
        trade = _overnight(bars, day, fee)
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
        trade = _overnight(bars, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
