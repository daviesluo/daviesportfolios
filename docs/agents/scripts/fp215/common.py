"""The search fp215. Two closes diverged, then a close-to-close spread.

Nothing here reads the network or a file. Both closes are known when the
signal day closes. The next close is long the lower close and short the
higher close, and both legs cover at the following close. Funding cash
is not added. The null is that spread on every day the two closes differ.
It is not an unconditional long and not an unconditional short. The level
chooses the two legs. It is not a spot long.
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
IDEA = "LVL"
# A signal on 2023-12-31 would enter on 2024-01-01. That day is not an entry.
SIGNAL_LAST_MS = fp5.SCREEN_END_MS - 2 * fp5.DAY_MS


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    """Sell at `fee` below the entry, buy back at `fee` above the later price."""
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


def _close(row: tuple) -> float | None:
    if len(row) < 1:
        raise ValueError("a level bar is the close")
    if row[0] <= 0.0:
        return None
    return row[0]


def _lower(left: float | None, right: float | None) -> str | None:
    if left is None or right is None or left == right:
        return None
    return "left" if left < right else "right"


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
    um: dict[int, tuple], cm: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    """Days the USDT close and the coin-margined close differ and the gap widened."""
    out = []
    for day in sorted(set(um) & set(cm)):
        if day > SIGNAL_LAST_MS:
            continue
        yday = day - fp5.DAY_MS
        entry = day + fp5.DAY_MS
        if not (fp5.SCREEN_START_MS <= entry < end_ms):
            continue
        if yday not in um or yday not in cm:
            continue
        left, right = _close(um[day]), _close(cm[day])
        prev_left, prev_right = _close(um[yday]), _close(cm[yday])
        if _lower(left, right) is None or prev_left is None or prev_right is None:
            continue
        if abs(left - right) > abs(prev_left - prev_right):
            out.append(day)
    return out


def _spread(
    um_sig: dict[int, tuple], cm_sig: dict[int, tuple],
    um_px: dict[int, tuple], cm_px: dict[int, tuple], entry: int, fee: float,
) -> dict | None:
    signal = entry - fp5.DAY_MS
    if signal not in um_sig or signal not in cm_sig:
        return None
    side = _lower(_close(um_sig[signal]), _close(cm_sig[signal]))
    exit_ms = entry + fp5.DAY_MS
    if side is None:
        return None
    if entry not in um_px or exit_ms not in um_px or entry not in cm_px or exit_ms not in cm_px:
        return None
    if side == "left":
        long_book, short_book = um_px, cm_px
    else:
        long_book, short_book = cm_px, um_px
    return _trade(
        long_book[entry][0], long_book[exit_ms][0],
        short_book[entry][0], short_book[exit_ms][0],
        entry, exit_ms, fee,
    )


def signal_trades(
    um_sig: dict[int, tuple], cm_sig: dict[int, tuple],
    um_px: dict[int, tuple], cm_px: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(um_sig, cm_sig, end_ms):
        entry = day + fp5.DAY_MS
        if not (start_ms <= entry < end_ms):
            continue
        trade = _spread(um_sig, cm_sig, um_px, cm_px, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    um_sig: dict[int, tuple], cm_sig: dict[int, tuple],
    um_px: dict[int, tuple], cm_px: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """The same choice of legs on every day the closes differ. The widening filter is off."""
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _spread(um_sig, cm_sig, um_px, cm_px, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
