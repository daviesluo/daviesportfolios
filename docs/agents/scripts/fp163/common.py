"""The search fp163. The taker ratio rose, then a long with a two-percent target.

Nothing here reads the network or a file. The last print is strictly above
the first. One is not the cut. The next day buys the open. If the high
reaches 2% above that open, the exit is that target. Otherwise the exit is
the close. Two percent is the rule, not a fitted width.
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
IDEA = "TAKTGT"
TARGET = 0.02


def signal_days(taker: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days whose last taker ratio is strictly above the first."""
    out = []
    for day in sorted(taker):
        if day >= end_ms:
            continue
        row = taker[day]
        if len(row) != 2:
            raise ValueError("the taker ratio is the first print and the last")
        if row[1] > row[0]:
            out.append(day)
    return out


def _target(bars: dict[int, tuple], entry: int, fee: float):
    if entry not in bars:
        return None
    if len(bars[entry]) != 3:
        raise ValueError("a bar is the open, the high and the close")
    open_px, high, close_px = bars[entry]
    target = open_px * (1.0 + TARGET)
    exit_px = target if high >= target else close_px
    gross = exit_px / open_px - 1.0
    net = fp5.net_return(open_px, exit_px, fee)
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
        trade = _target(bars, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """The same target, on every in-screen day, whether or not the ratio rose."""
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _target(bars, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
