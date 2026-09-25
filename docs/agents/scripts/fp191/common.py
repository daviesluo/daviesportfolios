"""The search fp191. The close finished above the day's average trade.

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
IDEA = "ABOVEVW"
# A signal on 2023-12-31 would enter on 2024-01-01. That day is not stored.
SIGNAL_LAST_MS = fp5.SCREEN_END_MS - 2 * fp5.DAY_MS



def signal_days(bars: dict[int, tuple], extra, end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days whose close finished above that day's average trade. `extra` is unused."""
    del extra
    out = []
    for day in sorted(bars):
        entry = day + fp5.DAY_MS
        if day > SIGNAL_LAST_MS or not (fp5.SCREEN_START_MS <= entry < end_ms):
            continue
        if len(bars[day]) != 4:
            raise ValueError("a spot bar is the open, the close, the base volume and the quote volume")
        _open_px, close_px, base, quote = bars[day]
        if base > 0 and close_px > quote / base:
            out.append(day)
    return out

def _session(bars: dict[int, tuple], entry: int, fee: float):
    if entry not in bars:
        return None
    open_px = bars[entry][0]
    close_px = bars[entry][1]
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
    bars: dict[int, tuple], extra, fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(bars, extra, end_ms):
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
