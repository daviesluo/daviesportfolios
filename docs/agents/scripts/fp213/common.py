"""The search fp213. Two funding rates moved opposite ways, then a one-day spread.

Nothing here reads the network or a file. Both 16:00 rates, and the
previous day's 16:00 rates, have already printed. The next session is
long the book whose rate fell and short the book whose rate rose.
Funding cash is not added. The null keeps that choice of legs on every
day the two changes differ, including days both rates rose or both fell.
It is not an unconditional long and not an unconditional short.
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
IDEA = "FCH"
# A signal on 2023-12-31 would enter on 2024-01-01. That day is not an entry.
SIGNAL_LAST_MS = fp5.SCREEN_END_MS - 2 * fp5.DAY_MS


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    """Sell at `fee` below the entry, buy back at `fee` above the later price."""
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


def _change(book: dict[int, float], day: int) -> float | None:
    prev = day - fp5.DAY_MS
    if day not in book or prev not in book:
        return None
    return book[day] - book[prev]


def _opposite(left: float | None, right: float | None) -> bool:
    """A zero change is neither a rise nor a fall."""
    if left is None or right is None:
        return False
    return (left > 0.0 > right) or (right > 0.0 > left)


def _trade(
    long_entry: float, long_exit: float, short_entry: float, short_exit: float,
    entry_ms: int, exit_ms: int, fee: float,
) -> dict | None:
    if min(long_entry, long_exit, short_entry, short_exit) <= 0.0:
        return None
    net = fp5.net_return(long_entry, long_exit, fee) + short_net(short_entry, short_exit, fee)
    gross = (long_exit / long_entry - 1.0) + (short_entry / short_exit - 1.0)
    return {
        "coin": COIN,
        "entry_ms": entry_ms,
        "exit_ms": exit_ms,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_days(
    um: dict[int, float], cm: dict[int, float], end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    """Days the two 16:00 funding changes have opposite signs."""
    out = []
    for day in sorted(set(um) & set(cm)):
        if day > SIGNAL_LAST_MS:
            continue
        entry = day + fp5.DAY_MS
        if not (fp5.SCREEN_START_MS <= entry < end_ms):
            continue
        if _opposite(_change(um, day), _change(cm, day)):
            out.append(day)
    return out


def _spread(
    um_rate: dict[int, float], cm_rate: dict[int, float],
    um_fill: dict[int, tuple], cm_fill: dict[int, tuple], entry: int, fee: float,
) -> dict | None:
    signal = entry - fp5.DAY_MS
    left, right = _change(um_rate, signal), _change(cm_rate, signal)
    if left is None or right is None or left == right:
        return None
    if entry not in um_fill or entry not in cm_fill:
        return None
    if len(um_fill[entry]) < 2 or len(cm_fill[entry]) < 2:
        raise ValueError("a session leg is the open and the close")
    if left < right:
        long_bar, short_bar = um_fill[entry], cm_fill[entry]
    else:
        long_bar, short_bar = cm_fill[entry], um_fill[entry]
    return _trade(long_bar[0], long_bar[1], short_bar[0], short_bar[1], entry, entry, fee)


def signal_trades(
    um_rate: dict[int, float], cm_rate: dict[int, float],
    um_fill: dict[int, tuple], cm_fill: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(um_rate, cm_rate, end_ms):
        entry = day + fp5.DAY_MS
        if not (start_ms <= entry < end_ms):
            continue
        trade = _spread(um_rate, cm_rate, um_fill, cm_fill, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    um_rate: dict[int, float], cm_rate: dict[int, float],
    um_fill: dict[int, tuple], cm_fill: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """The same choice of legs on every day the changes differ. The opposite-sign filter is off."""
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _spread(um_rate, cm_rate, um_fill, cm_fill, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
