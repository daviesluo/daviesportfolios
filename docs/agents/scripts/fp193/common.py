"""The search fp193. The last book snapshot was ask-heavy.

Nothing here reads the network or a file. The last snapshot is known before
the next open. The next day is short from the open to the close. The null
is that short on every day, not an unconditional long.
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
IDEA = "ASKSH"
# A signal on 2023-12-31 would enter on 2024-01-01. That day is not stored.
SIGNAL_LAST_MS = fp5.SCREEN_END_MS - 2 * fp5.DAY_MS


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    """Sell at `fee` below the entry, buy back at `fee` above the later price."""
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


def signal_days(book: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days whose last snapshot has more ask notional than bid notional."""
    out = []
    for day in sorted(book):
        if day > SIGNAL_LAST_MS:
            continue
        entry = day + fp5.DAY_MS
        if not (fp5.SCREEN_START_MS <= entry < end_ms):
            continue
        if len(book[day]) != 2:
            raise ValueError("a book day is the last bid and the last ask")
        bid, ask = book[day]
        if ask > bid:
            out.append(day)
    return out


def _session_short(bars: dict[int, tuple], entry: int, fee: float):
    if entry not in bars:
        return None
    if len(bars[entry]) < 2:
        raise ValueError("a spot bar is the open and the close")
    open_px = bars[entry][0]
    close_px = bars[entry][1]
    net = short_net(open_px, close_px, fee)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": entry,
        "gross": open_px / close_px - 1.0,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_trades(
    bars: dict[int, tuple], book: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(book, end_ms):
        entry = day + fp5.DAY_MS
        if not (start_ms <= entry < end_ms):
            continue
        trade = _session_short(bars, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """A spot session short on every in-screen day."""
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _session_short(bars, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
