"""The search fp165. A break that did not hold, then a one-day short.

Nothing here reads the network or a file. The high trades strictly above
yesterday's high and the close finishes strictly under that high. The next
day is short from the open to the next open. The funding cash is not added.
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
IDEA = "FAILSH"


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    """Sell at `fee` below the entry, buy back at `fee` above the later price."""
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


def signal_days(bars: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days that broke yesterday's high and closed back under it."""
    out = []
    for day in sorted(bars):
        prev = day - fp5.DAY_MS
        if day >= end_ms or prev not in bars:
            continue
        if len(bars[day]) != 3 or len(bars[prev]) != 3:
            raise ValueError("a bar is the open, the high and the close")
        level = bars[prev][1]
        _open, high, close_px = bars[day]
        if high > level and close_px < level:
            out.append(day)
    return out


def _short(bars: dict[int, tuple], entry: int, fee: float):
    exit_ms = entry + fp5.DAY_MS
    if entry not in bars or exit_ms not in bars:
        return None
    entry_px = bars[entry][0]
    exit_px = bars[exit_ms][0]
    gross = entry_px / exit_px - 1.0
    net = short_net(entry_px, exit_px, fee)
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
        trade = _short(bars, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """A one-day short on every in-screen day, failed break or not."""
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _short(bars, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
