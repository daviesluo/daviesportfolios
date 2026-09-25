"""The search fp204. The mark outran the coin-margined book, then a one-day spread.

Nothing here reads the network or a file. Both returns are known when the
signal day closes. The next day is long the coin-margined perpetual and
short the USDT perpetual, each from the open to the next open. Funding
cash is not added. The null is that spread on every day, not an
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
IDEA = "MKCM"
# A signal on 2023-12-31 would enter on 2024-01-01. That day is not an entry.
SIGNAL_LAST_MS = fp5.SCREEN_END_MS - 2 * fp5.DAY_MS


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    """Sell at `fee` below the entry, buy back at `fee` above the later price."""
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


def _ratio(open_px: float, close_px: float) -> float | None:
    if open_px <= 0.0 or close_px <= 0.0:
        return None
    return close_px / open_px


def signal_days(
    mark: dict[int, tuple], cm: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    """Days whose mark close/open finished strictly above the coin-margined close/open."""
    out = []
    for day in sorted(set(mark) & set(cm)):
        if day > SIGNAL_LAST_MS:
            continue
        entry = day + fp5.DAY_MS
        if not (fp5.SCREEN_START_MS <= entry < end_ms):
            continue
        if len(mark[day]) != 2 or len(cm[day]) < 2:
            raise ValueError("a bar is the open and the close")
        marked = _ratio(mark[day][0], mark[day][1])
        coin = _ratio(cm[day][0], cm[day][1])
        if marked is not None and coin is not None and marked > coin:
            out.append(day)
    return out


def _spread(cm: dict[int, tuple], um: dict[int, tuple], entry: int, fee: float):
    exit_ms = entry + fp5.DAY_MS
    if entry not in cm or exit_ms not in cm or entry not in um or exit_ms not in um:
        return None
    cm_entry, cm_exit = cm[entry][0], cm[exit_ms][0]
    um_entry, um_exit = um[entry][0], um[exit_ms][0]
    net = fp5.net_return(cm_entry, cm_exit, fee) + short_net(um_entry, um_exit, fee)
    gross = (cm_exit / cm_entry - 1.0) + (um_entry / um_exit - 1.0)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_trades(
    mark: dict[int, tuple], cm_sig: dict[int, tuple], cm: dict[int, tuple],
    um: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(mark, cm_sig, end_ms):
        entry = day + fp5.DAY_MS
        if not (start_ms <= entry < end_ms):
            continue
        trade = _spread(cm, um, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    cm: dict[int, tuple], um: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """The same open-to-open spread on every in-screen day both legs exist."""
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _spread(cm, um, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
