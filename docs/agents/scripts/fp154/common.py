"""The search fp154. Short the perpetual after a positive funding day.

Nothing here reads the network or a file. The position is short. The P&L
adds the hold day's 08:00 and 16:00 funding rates. The decision uses the
previous day's three rates and does not use the hold day's rates. The hold
is one day.
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
IDEA = "FNCARRY"


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


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    """Sell at `fee` below the entry, buy back at `fee` above the later price."""
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


def day_sum(rates: tuple[float, float, float]) -> float:
    return rates[0] + rates[1] + rates[2]


def signal_days(funding: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days whose three rates sum to strictly more than zero."""
    out = []
    for day in sorted(funding):
        if day >= end_ms:
            continue
        if day_sum(funding[day]) > 0.0:
            out.append(day)
    return out


def _short(um: dict[int, tuple], funding: dict[int, tuple], entry: int, fee: float):
    exit_ms = entry + fp5.DAY_MS
    if entry not in um or exit_ms not in um or entry not in funding:
        return None
    if len(um[entry]) != 1:
        raise ValueError("a fill bar is the open")
    rate_08 = funding[entry][1]
    rate_16 = funding[entry][2]
    entry_open = um[entry][0]
    exit_open = um[exit_ms][0]
    gross = (entry_open / exit_open - 1.0) + rate_08 + rate_16
    net = short_net(entry_open, exit_open, fee) + rate_08 + rate_16
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_trades(
    funding: dict[int, tuple], um: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(funding, end_ms):
        entry = day + fp5.DAY_MS
        if not (start_ms <= entry < end_ms):
            continue
        trade = _short(um, funding, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    funding: dict[int, tuple], um: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _short(um, funding, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
