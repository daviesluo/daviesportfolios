"""The search fp157. Five-day momentum, held two days.

Nothing here reads the network or a file. The signal is the sign of the
close against the close five days earlier. It is not a one-day return and
it is not a percentile. The fill buys the next open and sells the open two
days after that.
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
IDEA = "MOM5"
HORIZON = 5
HOLD_DAYS = 2


def signal_days(bars: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days whose close is strictly above the close five days earlier."""
    out = []
    for day in sorted(bars):
        if day >= end_ms:
            continue
        prev = day - HORIZON * fp5.DAY_MS
        if prev not in bars or day not in bars:
            continue
        if len(bars[day]) != 2 or len(bars[prev]) != 2:
            raise ValueError("a bar is the open and the close")
        if bars[day][1] > bars[prev][1]:
            out.append(day)
    return out


def _hold(bars: dict[int, tuple], entry: int, fee: float):
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if entry not in bars or exit_ms not in bars:
        return None
    entry_open = bars[entry][0]
    exit_open = bars[exit_ms][0]
    gross = exit_open / entry_open - 1.0
    net = fp5.net_return(entry_open, exit_open, fee)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": gross,
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
