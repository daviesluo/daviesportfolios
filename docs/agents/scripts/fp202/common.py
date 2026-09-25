"""The search fp202. The USDT close finished above its own average.

Nothing here reads the network or a file. The close and the average are
known when the signal day closes. The next coin-margined open is sold and
the following open is bought. The null is that short on every day, not an
unconditional long.
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
IDEA = "UMVW"
# A signal on 2023-12-31 would enter on 2024-01-01. That day is not an entry.
SIGNAL_LAST_MS = fp5.SCREEN_END_MS - 2 * fp5.DAY_MS


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    """Sell at `fee` below the entry, buy back at `fee` above the later price."""
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


def _vwap(row: tuple) -> float | None:
    if len(row) != 3:
        raise ValueError("the average is the close, the base and the quote")
    base, quote = row[1], row[2]
    if base <= 0.0 or quote <= 0.0:
        return None
    return quote / base


def signal_days(um: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days whose USDT close finished strictly above that day's average trade."""
    out = []
    for day in sorted(um):
        if day > SIGNAL_LAST_MS:
            continue
        entry = day + fp5.DAY_MS
        if not (fp5.SCREEN_START_MS <= entry < end_ms):
            continue
        average = _vwap(um[day])
        if average is not None and um[day][0] > average:
            out.append(day)
    return out


def _open_short(bars: dict[int, tuple], entry: int, fee: float):
    exit_ms = entry + fp5.DAY_MS
    if entry not in bars or exit_ms not in bars:
        return None
    if len(bars[entry]) < 1 or len(bars[exit_ms]) < 1:
        raise ValueError("an open-to-open short is two opens")
    entry_px = bars[entry][0]
    exit_px = bars[exit_ms][0]
    net = short_net(entry_px, exit_px, fee)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": entry_px / exit_px - 1.0,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_trades(
    um: dict[int, tuple], cm: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(um, end_ms):
        entry = day + fp5.DAY_MS
        if not (start_ms <= entry < end_ms):
            continue
        trade = _open_short(cm, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    cm: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """A coin-margined open-to-next-open short on every in-screen day."""
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _open_short(cm, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
