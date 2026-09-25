"""The search fp214. Two mark residuals had opposite signs, then a close-to-close spread.

Nothing here reads the network or a file. Spot's close/open, the USDT
perpetual's close/open, and the mark's close/open are known when the
signal day closes. The next close is long the more negative residual and
short the more positive one, and both legs cover at the following close.
Funding cash is not added. The null keeps that choice of legs on every
day the two residuals differ. It is not an unconditional long and not an
unconditional short.
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
IDEA = "MRK"
# A signal on 2023-12-31 would enter on 2024-01-01. That day is not an entry.
SIGNAL_LAST_MS = fp5.SCREEN_END_MS - 2 * fp5.DAY_MS


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    """Sell at `fee` below the entry, buy back at `fee` above the later price."""
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


def _resid(row: tuple, mark: tuple) -> float | None:
    if len(row) < 2 or len(mark) < 2:
        raise ValueError("a residual bar is the open and the close")
    if min(row[0], row[1], mark[0], mark[1]) <= 0.0:
        return None
    return row[1] / row[0] - mark[1] / mark[0]


def _opposite(left: float | None, right: float | None) -> bool:
    """A zero residual is neither positive nor negative."""
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
    spot: dict[int, tuple], um: dict[int, tuple], mark: dict[int, tuple],
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    """Days spot's residual and the USDT residual have opposite signs."""
    out = []
    for day in sorted(set(spot) & set(um) & set(mark)):
        if day > SIGNAL_LAST_MS:
            continue
        entry = day + fp5.DAY_MS
        if not (fp5.SCREEN_START_MS <= entry < end_ms):
            continue
        if _opposite(_resid(spot[day], mark[day]), _resid(um[day], mark[day])):
            out.append(day)
    return out


def _spread(
    spot_sig: dict[int, tuple], um_sig: dict[int, tuple], mark: dict[int, tuple],
    spot_px: dict[int, tuple], um_px: dict[int, tuple], entry: int, fee: float,
) -> dict | None:
    signal = entry - fp5.DAY_MS
    if signal not in spot_sig or signal not in um_sig or signal not in mark:
        return None
    left = _resid(spot_sig[signal], mark[signal])
    right = _resid(um_sig[signal], mark[signal])
    if left is None or right is None or left == right:
        return None
    exit_ms = entry + fp5.DAY_MS
    if entry not in spot_px or exit_ms not in spot_px or entry not in um_px or exit_ms not in um_px:
        return None
    if left < right:
        long_book, short_book = spot_px, um_px
    else:
        long_book, short_book = um_px, spot_px
    return _trade(
        long_book[entry][0], long_book[exit_ms][0],
        short_book[entry][0], short_book[exit_ms][0],
        entry, exit_ms, fee,
    )


def signal_trades(
    spot_sig: dict[int, tuple], um_sig: dict[int, tuple], mark: dict[int, tuple],
    spot_px: dict[int, tuple], um_px: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(spot_sig, um_sig, mark, end_ms):
        entry = day + fp5.DAY_MS
        if not (start_ms <= entry < end_ms):
            continue
        trade = _spread(spot_sig, um_sig, mark, spot_px, um_px, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    spot_sig: dict[int, tuple], um_sig: dict[int, tuple], mark: dict[int, tuple],
    spot_px: dict[int, tuple], um_px: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """The same choice of legs on every day the residuals differ. The opposite-sign filter is off."""
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _spread(spot_sig, um_sig, mark, spot_px, um_px, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
