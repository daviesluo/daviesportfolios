"""The search fp176. A close above the prior three closes, held three days.

Nothing here reads the network or a file. Today's close is strictly above
each of the three prior closes. That is known when today closes. Three days
is the hold. The next day buys the open and sells the open three days later.
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
IDEA = "C3"
HOLD_DAYS = 3


def signal_days(bars: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days whose close is strictly above each of the three prior closes."""
    out = []
    for day in sorted(bars):
        if day >= end_ms or day not in bars:
            continue
        prior = []
        missing = False
        for k in range(1, 4):
            prev = day - k * fp5.DAY_MS
            if prev not in bars:
                missing = True
                break
            prior.append(bars[prev][3])
        if missing:
            continue
        if len(bars[day]) != 4:
            raise ValueError("a bar is the open, the high, the low and the close")
        if bars[day][3] > max(prior):
            out.append(day)
    return out


def _hold(bars: dict[int, tuple], entry: int, fee: float):
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if entry not in bars or exit_ms not in bars:
        return None
    entry_px = bars[entry][0]
    exit_px = bars[exit_ms][0]
    net = fp5.net_return(entry_px, exit_px, fee)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": exit_px / entry_px - 1.0,
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
        trade = _hold(bars, entry, fee)
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
        trade = _hold(bars, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
