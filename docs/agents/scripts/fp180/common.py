"""The search fp180. A close back above the prior down day's open.

Nothing here reads the network or a file. The signal is known when the
signal day closes. The next day is the entry. The entry day's high, low
and close are not read to decide the entry.
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
IDEA = "REVCLOSE"

def signal_days(bars: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days that closed strictly above the open of a prior down day."""
    out = []
    for day in sorted(bars):
        prev = day - fp5.DAY_MS
        if day >= end_ms or prev not in bars:
            continue
        if len(bars[day]) != 4 or len(bars[prev]) != 4:
            raise ValueError("a bar is the open, the high, the low and the close")
        prior_open = bars[prev][0]
        prior_close = bars[prev][3]
        if prior_close < prior_open and bars[day][3] > prior_open:
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
