"""The search fp170. The 08:00 funding print is the lowest, then a one-day long.

Nothing here reads the network or a file. The 08:00 rate is strictly under
the 00:00 rate and strictly under the 16:00 rate. That is known at 16:00.
The next daily open is later. The fill is one day long. The funding cash
is not added. The rates are not ranked against another day.
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
IDEA = "FNTROUGH"


def funding_hours(events: list[tuple[int, float]]) -> dict[int, tuple[float, float, float]]:
    """UTC day -> (00:00, 08:00, 16:00). A day without those three hours is absent."""
    found: dict[int, dict[int, float]] = {}
    for ts, rate in events:
        bucket = fp5.bucket_8h(int(ts))
        if bucket is None:
            continue
        day = bucket - (bucket % fp5.DAY_MS)
        hour = (bucket % fp5.DAY_MS) // fp5.EIGHT_H_MS
        if hour not in (0, 1, 2):
            continue
        slot = found.setdefault(day, {})
        if hour in slot:
            raise ValueError(f"two funding prints share an hour: {day}")
        slot[hour] = float(rate)
    out: dict[int, tuple[float, float, float]] = {}
    for day in sorted(found):
        slot = found[day]
        if set(slot) != {0, 1, 2}:
            continue
        out[day] = (slot[0], slot[1], slot[2])
    return out


def signal_days(funding: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days whose 08:00 rate is strictly the lowest of the three."""
    out = []
    for day in sorted(funding):
        if day >= end_ms:
            continue
        rate_00, rate_08, rate_16 = funding[day]
        if rate_08 < rate_00 and rate_08 < rate_16:
            out.append(day)
    return out


def signal_trades(
    funding: dict[int, tuple], bars: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(funding, end_ms):
        entry = day + fp5.DAY_MS
        trade = fp5._trade(COIN, entry, entry + fp5.DAY_MS, bars, fee, start_ms, end_ms)
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
        trade = fp5._trade(COIN, day, day + fp5.DAY_MS, bars, fee, start_ms, end_ms)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
