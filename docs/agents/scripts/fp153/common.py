"""The search fp153. Cash-and-carry when the premium close is above zero.

Nothing here reads the network or a file. Spot is bought and the USDT
perpetual is sold. Each leg pays the fee. The short keeps the hold day's
08:00 and 16:00 funding. The 00:00 print at the entry, and the 00:00 print
at the exit, are not in the P&L. The hold is one day.
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
IDEA = "BASBOOK"

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



def carry_net(
    spot_entry: float, spot_exit: float, um_entry: float, um_exit: float,
    rate_08: float, rate_16: float, fee: float = fp5.FEE,
) -> tuple[float, float]:
    gross = (spot_exit / spot_entry - 1.0) + (um_entry / um_exit - 1.0) + rate_08 + rate_16
    net = (
        fp5.net_return(spot_entry, spot_exit, fee)
        + short_net(um_entry, um_exit, fee)
        + rate_08
        + rate_16
    )
    return gross, net


def signal_days(premium: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days whose premium close is strictly above zero."""
    out = []
    for day in sorted(premium):
        if day >= end_ms:
            continue
        row = premium[day]
        if len(row) != 1:
            raise ValueError("the premium close is one number")
        if row[0] > 0.0:
            out.append(day)
    return out


def _book(spot, um, funding, entry: int, fee: float):
    exit_ms = entry + fp5.DAY_MS
    if entry not in spot or exit_ms not in spot or entry not in um or exit_ms not in um:
        return None
    if entry not in funding:
        return None
    if len(spot[entry]) != 1 or len(um[entry]) != 1:
        raise ValueError("a fill bar is the open")
    gross, net = carry_net(
        spot[entry][0], spot[exit_ms][0], um[entry][0], um[exit_ms][0],
        funding[entry][1], funding[entry][2], fee,
    )
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_trades(
    premium: dict[int, tuple], spot: dict[int, tuple], um: dict[int, tuple],
    funding: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(premium, end_ms):
        entry = day + fp5.DAY_MS
        if not (start_ms <= entry < end_ms):
            continue
        trade = _book(spot, um, funding, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    spot: dict[int, tuple], um: dict[int, tuple], funding: dict[int, tuple],
    fee: float = fp5.FEE, start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _book(spot, um, funding, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
