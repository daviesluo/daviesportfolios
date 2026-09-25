"""The search fp167. The widest range of four days, then a session long.

Nothing here reads the network or a file. Today's high minus today's low
is strictly wider than each of the three days before it. The next day buys
the open and sells the close. A percentile is not used.
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
IDEA = "WIDE4"


def _range(bar: tuple) -> float:
    # open, high, low, close
    return bar[1] - bar[2]


def signal_days(bars: dict[int, tuple], end_ms: int = fp5.SCREEN_END_MS) -> list[int]:
    """Days wider than each of the three UTC days before them."""
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
            prior.append(_range(bars[prev]))
        if missing:
            continue
        if len(bars[day]) != 4:
            raise ValueError("a bar is the open, the high, the low and the close")
        if _range(bars[day]) > max(prior):
            out.append(day)
    return out


def _session(bars: dict[int, tuple], entry: int, fee: float):
    if entry not in bars:
        return None
    open_px = bars[entry][0]
    close_px = bars[entry][3]
    gross = close_px / open_px - 1.0
    net = fp5.net_return(open_px, close_px, fee)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": entry,
        "gross": gross,
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
