"""The search fp164. Buy a break of yesterday's high when the day is the widest of four.

Nothing here reads the network or a file. The high has to trade strictly
above yesterday's high, and the day's range has to be strictly wider than
each of the three days before it. The fill buys yesterday's high, or the
open when the open is already through that high, and sells the close.
A percentile is not used.
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
IDEA = "BRKHI"


def _range(bar: tuple) -> float:
    # open, high, low, close
    return bar[1] - bar[2]


def widest(bars: dict[int, tuple], day: int) -> bool:
    """True when this day's range is strictly wider than each of the prior three."""
    if day not in bars:
        return False
    prior = []
    for k in range(1, 4):
        prev = day - k * fp5.DAY_MS
        if prev not in bars:
            return False
        prior.append(_range(bars[prev]))
    return _range(bars[day]) > max(prior)


def _break(bars: dict[int, tuple], day: int, fee: float):
    prev = day - fp5.DAY_MS
    if day not in bars or prev not in bars:
        return None
    if len(bars[day]) != 4:
        raise ValueError("a bar is the open, the high, the low and the close")
    level = bars[prev][1]
    open_px, high, _low, close_px = bars[day]
    if high <= level:
        return None
    entry_px = open_px if open_px > level else level
    gross = close_px / entry_px - 1.0
    net = fp5.net_return(entry_px, close_px, fee)
    return {
        "coin": COIN,
        "entry_ms": day,
        "exit_ms": day,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_trades(
    bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    day = start_ms
    while day < end_ms:
        if widest(bars, day):
            trade = _break(bars, day, fee)
            if trade is not None:
                trades.append(trade)
        day += fp5.DAY_MS
    return trades


def pool_nets(
    bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """Every break of yesterday's high, widest day or not."""
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _break(bars, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
