"""The search fp155. Long the session after buyers were the aggressive side.

Nothing here reads the network or a file. The cut is the last taker ratio
against one, not a percentile. The fill buys the next open and sells that
day's close.
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
IDEA = "TAKSESS"


def signal_days(taker: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days whose last taker long/short ratio is strictly above one."""
    out = []
    for day in sorted(taker):
        if day >= end_ms:
            continue
        row = taker[day]
        if len(row) != 1:
            raise ValueError("the taker ratio is one number")
        if row[0] > 1.0:
            out.append(day)
    return out


def _session(bars: dict[int, tuple], entry: int, fee: float):
    if entry not in bars:
        return None
    if len(bars[entry]) != 2:
        raise ValueError("a session bar is the open and the close")
    open_px, close_px = bars[entry]
    gross = close_px / open_px - 1.0
    net = fp5.net_return(open_px, close_px, fee)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": entry,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_trades(
    taker: dict[int, tuple], bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(taker, end_ms):
        entry = day + fp5.DAY_MS
        if not (start_ms <= entry < end_ms):
            continue
        trade = _session(bars, entry, fee)
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
        trade = _session(bars, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
