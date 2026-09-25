"""The search fp196. The coin-margined close finished above spot.

Nothing here reads the network or a file. Both closes are known when the
signal day closes. The next day is long spot and short the coin-margined
perpetual, each from the open to the close. Funding cash is not added.
The null is that hedge on every day, not an unconditional long.
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
IDEA = "CMH"
# A signal on 2023-12-31 would enter on 2024-01-01. That day is not stored.
SIGNAL_LAST_MS = fp5.SCREEN_END_MS - 2 * fp5.DAY_MS


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    """Sell at `fee` below the entry, buy back at `fee` above the later price."""
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


def signal_days(
    spot: dict[int, tuple], cm: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS,
) -> list[int]:
    """Days whose coin-margined close finished strictly above the spot close."""
    out = []
    for day in sorted(set(spot) & set(cm)):
        if day > SIGNAL_LAST_MS:
            continue
        entry = day + fp5.DAY_MS
        if not (fp5.SCREEN_START_MS <= entry < end_ms):
            continue
        if len(spot[day]) < 2 or len(cm[day]) < 2:
            raise ValueError("a bar is the open and the close")
        if cm[day][1] > spot[day][1]:
            out.append(day)
    return out


def _hedge(spot: dict[int, tuple], cm: dict[int, tuple], entry: int, fee: float):
    if entry not in spot or entry not in cm:
        return None
    if len(spot[entry]) < 2 or len(cm[entry]) < 2:
        raise ValueError("a session leg is the open and the close")
    spot_open, spot_close = spot[entry][0], spot[entry][1]
    cm_open, cm_close = cm[entry][0], cm[entry][1]
    net = fp5.net_return(spot_open, spot_close, fee) + short_net(cm_open, cm_close, fee)
    gross = (spot_close / spot_open - 1.0) + (cm_open / cm_close - 1.0)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": entry,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_trades(
    spot: dict[int, tuple], cm: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[dict]:
    trades = []
    for day in signal_days(spot, cm, end_ms):
        entry = day + fp5.DAY_MS
        if not (start_ms <= entry < end_ms):
            continue
        trade = _hedge(spot, cm, entry, fee)
        if trade is not None:
            trades.append(trade)
    return trades


def pool_nets(
    spot: dict[int, tuple], cm: dict[int, tuple], fee: float = fp5.FEE,
    start_ms: int = fp5.SCREEN_START_MS, end_ms: int = fp5.SCREEN_END_MS,
) -> list[float]:
    """The same two-leg session on every in-screen day both legs exist."""
    pool = []
    day = start_ms
    while day < end_ms:
        trade = _hedge(spot, cm, day, fee)
        if trade is not None:
            pool.append(trade["net"])
        day += fp5.DAY_MS
    return pool
