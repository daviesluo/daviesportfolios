"""The search fp206. Coin-margined funding changed sign through the day.

Nothing here reads the network or a file. The 00:00 rate and the 16:00
rate are both known at 16:00. That day's coin-margined close is sold and
the next open is bought. The close is the fill, not an input. The 08:00
rate is not read. Funding cash is not added. The null is that overnight
short on every day, not an unconditional long.
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
IDEA = "CMFN"
# 2023-12-31 may be sold at the close. The next open is the cover, not an entry.
ENTRY_LAST_MS = fp5.SCREEN_END_MS - fp5.DAY_MS


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    """Sell at `fee` below the entry, buy back at `fee` above the later price."""
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


def signal_days(funding: dict[int, float], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days whose 00:00 coin-margined rate is strictly negative and whose 16:00 rate is strictly positive."""
    out = []
    for bucket in sorted(funding):
        if bucket % fp5.DAY_MS != 0:
            continue
        day = bucket
        if day >= end_ms or day > ENTRY_LAST_MS:
            continue
        if not (fp5.SCREEN_START_MS <= day < end_ms):
            continue
        afternoon = day + 2 * fp5.EIGHT_H_MS
        if afternoon not in funding:
            continue
        if funding[day] < 0.0 < funding[afternoon]:
            out.append(day)
    return out


def _overnight(bars: dict[int, tuple], day: int, fee: float):
    exit_ms = day + fp5.DAY_MS
    if day not in bars or exit_ms not in bars:
        return None
    if len(bars[day]) < 2 or len(bars[exit_ms]) < 1:
        raise ValueError("the sell is the close and the cover is the next open")
    entry_px = bars[day][1]
    exit_px = bars[exit_ms][0]
    net = short_net(entry_px, exit_px, fee)
    return {
        "coin": COIN,
        "entry_ms": day,
        "exit_ms": exit_ms,
        "gross": entry_px / exit_px - 1.0,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_trades(
    bars: dict[int, tuple], funding: dict[int, float], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(funding, end_ms):
        if not (start_ms <= day < end_ms):
            continue
        trade = _overnight(bars, day, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """A coin-margined overnight short on every in-screen day."""
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _overnight(bars, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
