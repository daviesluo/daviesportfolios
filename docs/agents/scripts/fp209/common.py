"""The search fp209. Two session averages diverged, then a one-day spread.

Nothing here reads the network or a file. Both closes and both session
averages are known when the signal day closes. The next session is long
the lower close-over-average and short the higher one. Funding cash is
not added. The null is that spread on every day the two scores differ.
It is not an unconditional long and not an unconditional short.
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
IDEA = "SVW"
# A signal on 2023-12-31 would enter on 2024-01-01. That day is not an entry.
SIGNAL_LAST_MS = fp5.SCREEN_END_MS - 2 * fp5.DAY_MS


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    """Sell at `fee` below the entry, buy back at `fee` above the later price."""
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


def _score(row: tuple) -> float | None:
    if len(row) != 3:
        raise ValueError("a score bar is the close, the base and the quote")
    close, base, quote = row
    if close <= 0.0 or base <= 0.0 or quote <= 0.0:
        return None
    return close * base / quote


def _lower(left: float | None, right: float | None) -> str | None:
    """'left' when the left score is strictly lower. Equal scores do not fire."""
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
    spot: dict[int, tuple], um: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    """Days the two close-over-average scores differ and the gap widened."""
    out = []
    for day in sorted(set(spot) & set(um)):
        if day > SIGNAL_LAST_MS:
            continue
        yday = day - fp5.DAY_MS
        entry = day + fp5.DAY_MS
        if not (fp5.SCREEN_START_MS <= entry < end_ms):
            continue
        if yday not in spot or yday not in um:
            continue
        left, right = _score(spot[day]), _score(um[day])
        prev_left, prev_right = _score(spot[yday]), _score(um[yday])
        if _lower(left, right) is None or prev_left is None or prev_right is None:
            continue
        if abs(left - right) > abs(prev_left - prev_right):
            out.append(day)
    return out


def _spread(
    spot_sig: dict[int, tuple], um_sig: dict[int, tuple],
    spot_fill: dict[int, tuple], um_fill: dict[int, tuple], entry: int, fee: float,
) -> dict | None:
    signal = entry - fp5.DAY_MS
    if signal not in spot_sig or signal not in um_sig:
        return None
    side = _lower(_score(spot_sig[signal]), _score(um_sig[signal]))
    if side is None or entry not in spot_fill or entry not in um_fill:
        return None
    if len(spot_fill[entry]) < 2 or len(um_fill[entry]) < 2:
        raise ValueError("a session leg is the open and the close")
    if side == "left":
        long_bar, short_bar = spot_fill[entry], um_fill[entry]
    else:
        long_bar, short_bar = um_fill[entry], spot_fill[entry]
    return _trade(long_bar[0], long_bar[1], short_bar[0], short_bar[1], entry, entry, fee)


def signal_trades(
    spot_sig: dict[int, tuple], um_sig: dict[int, tuple],
    spot_fill: dict[int, tuple], um_fill: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(spot_sig, um_sig, end_ms):
        entry = day + fp5.DAY_MS
        if not (start_ms <= entry < end_ms):
            continue
        trade = _spread(spot_sig, um_sig, spot_fill, um_fill, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    spot_sig: dict[int, tuple], um_sig: dict[int, tuple],
    spot_fill: dict[int, tuple], um_fill: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """The same choice of legs on every day the scores differ. The widening filter is off."""
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _spread(spot_sig, um_sig, spot_fill, um_fill, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
