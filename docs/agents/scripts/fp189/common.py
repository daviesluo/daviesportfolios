"""The search fp189. USDT funding finished under coin-margined funding.

Nothing here reads the network or a file. The signal is known when the
signal day closes. The next day is the entry. The entry day's high, low
and close are not read to decide the entry.
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
IDEA = "UMLT"
# A signal on 2023-12-31 would enter on 2024-01-01. That day is not stored.
SIGNAL_LAST_MS = fp5.SCREEN_END_MS - 2 * fp5.DAY_MS



def last_aligned(day: int, um: dict[int, float], cm: dict[int, float]) -> int | None:
    last = None
    for bucket in (day, day + fp5.EIGHT_H_MS, day + 2 * fp5.EIGHT_H_MS):
        if bucket in um and bucket in cm:
            last = bucket
    return last


def signal_days(bars: dict[int, tuple], rates: tuple[dict[int, float], dict[int, float]], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days whose last aligned USDT funding rate finished under the coin-margined rate."""
    um, cm = rates
    out = []
    for bucket in um:
        if bucket >= fp5.SCREEN_END_MS:
            raise ValueError("a funding print is in 2024")
    day = fp5.SCREEN_START_MS - fp5.DAY_MS
    while day <= SIGNAL_LAST_MS:
        entry = day + fp5.DAY_MS
        bucket = last_aligned(day, um, cm)
        if entry < end_ms and bucket is not None and um[bucket] < cm[bucket]:
            out.append(day)
        day += fp5.DAY_MS
    return out

def _session(bars: dict[int, tuple], entry: int, fee: float):
    if entry not in bars:
        return None
    open_px = bars[entry][0]
    close_px = bars[entry][1]
    net = fp5.net_return(open_px, close_px, fee)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": entry,
        "gross": close_px / open_px - 1.0,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_trades(
    bars: dict[int, tuple], extra, fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(bars, extra, end_ms):
        entry = day + fp5.DAY_MS
        if not (start_ms <= entry < end_ms):
            continue
        trade = _session(bars, entry, fee)
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
        trade = _session(bars, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
