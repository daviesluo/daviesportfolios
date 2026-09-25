"""The search fp212. The front quarterly outran the perpetual, then a one-day spread.

Nothing here reads the network or a file. Both close/open ratios are known
when the signal day closes. The contract is the front quarterly of the
entry day, and that same contract supplies the signal day's ratio. The
next session is long the coin-margined perpetual and short that quarterly.
Funding cash is not added. The null is that spread on every day both
session bars exist. It is not an unconditional long and not an
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
IDEA = "CAL"
# A signal on 2023-12-31 would enter on 2024-01-01. That day is not an entry.
SIGNAL_LAST_MS = fp5.SCREEN_END_MS - 2 * fp5.DAY_MS

# Expiry midnight UTC, then the symbol. Bi-quarterlies are not in this list.
# On the expiry day the expiring contract is still the front.
QUARTERS = (
    (1_680_220_800_000, "BTCUSD_230331"),
    (1_688_083_200_000, "BTCUSD_230630"),
    (1_695_945_600_000, "BTCUSD_230929"),
    (1_703_808_000_000, "BTCUSD_231229"),
    (1_711_670_400_000, "BTCUSD_240329"),
)


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    """Sell at `fee` below the entry, buy back at `fee` above the later price."""
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


def front_symbol(entry_ms: int) -> str | None:
    """The nearest quarterly whose expiry is on or after the entry day."""
    for expiry, symbol in QUARTERS:
        if expiry >= entry_ms:
            return symbol
    return None


def _ratio(row: tuple) -> float | None:
    if len(row) < 2:
        raise ValueError("a return bar is the open and the close")
    open_px, close_px = row[0], row[1]
    if open_px <= 0.0 or close_px <= 0.0:
        return None
    return close_px / open_px


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


def _book(quarters: dict[str, dict[int, tuple]], entry: int) -> dict[int, tuple] | None:
    symbol = front_symbol(entry)
    if symbol is None:
        return None
    return quarters.get(symbol)


def signal_days(
    perp: dict[int, tuple], quarters: dict[str, dict[int, tuple]],
    end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    """Days the entry day's front quarterly close/open finished strictly above the perpetual."""
    out = []
    for day in sorted(perp):
        if day > SIGNAL_LAST_MS:
            continue
        entry = day + fp5.DAY_MS
        if not (fp5.SCREEN_START_MS <= entry < end_ms):
            continue
        book = _book(quarters, entry)
        if book is None or day not in book or day not in perp:
            continue
        quarter = _ratio(book[day])
        coin = _ratio(perp[day])
        if quarter is not None and coin is not None and quarter > coin:
            out.append(day)
    return out


def _spread(
    quarters: dict[str, dict[int, tuple]], perp_fill: dict[int, tuple],
    entry: int, fee: float,
) -> dict | None:
    book = _book(quarters, entry)
    if book is None or entry not in book or entry not in perp_fill:
        return None
    if len(book[entry]) < 2 or len(perp_fill[entry]) < 2:
        raise ValueError("a session leg is the open and the close")
    long_bar, short_bar = perp_fill[entry], book[entry]
    return _trade(long_bar[0], long_bar[1], short_bar[0], short_bar[1], entry, entry, fee)


def signal_trades(
    perp: dict[int, tuple], quarters: dict[str, dict[int, tuple]],
    perp_fill: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(perp, quarters, end_ms):
        entry = day + fp5.DAY_MS
        if not (start_ms <= entry < end_ms):
            continue
        trade = _spread(quarters, perp_fill, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    quarters: dict[str, dict[int, tuple]], perp_fill: dict[int, tuple],
    fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """Long the perpetual and short that day's front quarterly whenever both bars exist."""
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _spread(quarters, perp_fill, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
