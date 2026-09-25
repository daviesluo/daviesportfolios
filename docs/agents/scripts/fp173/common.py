"""The search fp173. Inside the range of three days ago, then the next session.

Nothing here reads the network or a file. Today's high is strictly under the
high of the day three days earlier, and today's low is strictly above that
day's low. Both are known when today closes. Yesterday is not the comparison.
The next day buys the open and sells the close.
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
IDEA = "COIL"
HORIZON = 3


def signal_days(bars: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days that sit strictly inside the high and the low of three days earlier."""
    out = []
    for day in sorted(bars):
        old = day - HORIZON * fp5.DAY_MS
        if day >= end_ms or old not in bars or day not in bars:
            continue
        if len(bars[day]) != 4 or len(bars[old]) != 4:
            raise ValueError("a bar is the open, the high, the low and the close")
        if bars[day][1] < bars[old][1] and bars[day][2] > bars[old][2]:
            out.append(day)
    return out


def _session(bars: dict[int, tuple], entry: int, fee: float):
    if entry not in bars:
        return None
    open_px = bars[entry][0]
    close_px = bars[entry][3]
    net = fp5.net_return(open_px, close_px, fee)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": entry,
        "gross": close_px / open_px - 1.0,
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
