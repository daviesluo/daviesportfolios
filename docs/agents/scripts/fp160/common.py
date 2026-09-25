"""The search fp160. Long after the taker ratio crosses up through one.

Nothing here reads the network or a file. The entry is the day after the
last print crosses from at or under one to strictly above one. The exit is
the next open after a later last print is back at or under one. If that has
not happened after five daily observations, the exit is the open five days
after entry. Five is the cap, not a fitted hold.
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
IDEA = "TAKX"
MAX_HOLD = 5


def signal_days(taker: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days that cross up through one from the previous UTC date."""
    out = []
    for day in sorted(taker):
        prev = day - fp5.DAY_MS
        if day >= end_ms or prev not in taker:
            continue
        if len(taker[day]) != 1 or len(taker[prev]) != 1:
            raise ValueError("the taker ratio is one number")
        if taker[prev][0] <= 1.0 and taker[day][0] > 1.0:
            out.append(day)
    return out


def hold_exit(taker: dict[int, float], entry: int) -> int | None:
    """The open at which the long ends. None when a required print is missing."""
    for k in range(1, MAX_HOLD + 1):
        observed = entry + (k - 1) * fp5.DAY_MS
        if observed not in taker:
            return None
        if taker[observed] <= 1.0 or k == MAX_HOLD:
            return entry + k * fp5.DAY_MS
    return None


def _values(taker: dict[int, tuple]) -> dict[int, float]:
    return {day: taker[day][0] for day in taker}


def _trade(bars: dict[int, tuple], taker: dict[int, float], entry: int, fee: float):
    exit_ms = hold_exit(taker, entry)
    if exit_ms is None:
        return None
    trade = fp5._trade(COIN, entry, exit_ms, bars, fee, fp5.SCREEN_START_MS, fp5.SCREEN_END_MS)
    return trade


def signal_trades(
    taker: dict[int, tuple], bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    values = _values(taker)
    trades = []
    for day in signal_days(taker, end_ms):
        entry = day + fp5.DAY_MS
        if not (start_ms <= entry < end_ms):
            continue
        trade = _trade(bars, values, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    taker: dict[int, tuple], bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """The same exit, started on every in-screen day, cross or not."""
    values = _values(taker)
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _trade(bars, values, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
