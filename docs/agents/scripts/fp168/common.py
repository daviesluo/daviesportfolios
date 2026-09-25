"""The search fp168. Inventory and aggressive buying both rose, held two days.

Nothing here reads the network or a file. The last dollar open interest is
above the first, and the last taker ratio is above the first. The fill buys
the next open and sells the open two days later. A percentile is not used.
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
IDEA = "FLOW"
HOLD_DAYS = 2


def signal_days(
    oi: dict[int, tuple], taker: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    """Days that added inventory and whose taker ratio rose."""
    out = []
    for day in sorted(oi):
        if day >= end_ms or day not in taker:
            continue
        if len(oi[day]) != 2 or len(taker[day]) != 2:
            raise ValueError("each series is a first print and a last print")
        first_oi, last_oi = oi[day]
        first_taker, last_taker = taker[day]
        if first_oi > 0.0 and last_oi > first_oi and last_taker > first_taker:
            out.append(day)
    return out


def _hold(bars: dict[int, tuple], entry: int, fee: float):
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if entry not in bars or exit_ms not in bars:
        return None
    gross = bars[exit_ms][0] / bars[entry][0] - 1.0
    net = fp5.net_return(bars[entry][0], bars[exit_ms][0], fee)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_trades(
    oi: dict[int, tuple], taker: dict[int, tuple], bars: dict[int, tuple],
    fee: float = fp5.FEE, start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(oi, taker, end_ms):
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
