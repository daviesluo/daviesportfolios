"""The search fp221. A finished up-week on spot, then a seven-day spot long.

Nothing here reads the network or a file. The signal is spot's close
against its close seven days earlier, and both closes are finished
before the entry open. The position is one spot leg, held seven days.
It is not a one-day trade and it is not an overnight trade. Funding
cash is not added. The null is that same seven-day spot long on every
day the two closes exist, including a down week and a flat week.
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
IDEA = "SMO"
HOLD_DAYS = 7


def _days():
    t = fp5.SCREEN_START_MS
    while t < fp5.SCREEN_END_MS:
        yield t
        t += fp5.DAY_MS


def _px(book: dict, ts: int, index: int) -> float | None:
    row = book.get(ts)
    if row is None:
        return None
    if len(row) <= index:
        raise ValueError("a spot bar is the open and the close")
    px = float(row[index])
    if px <= 0.0:
        return None
    return px


def _week(book: dict, entry: int) -> float | None:
    earlier = _px(book, entry - 8 * fp5.DAY_MS, 1)
    later = _px(book, entry - fp5.DAY_MS, 1)
    if earlier is None or later is None:
        return None
    return later / earlier - 1.0


def _long(entry: int, book: dict) -> dict | None:
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if exit_ms > fp5.SCREEN_END_MS:
        return None
    entry_px = _px(book, entry, 0)
    exit_px = _px(book, exit_ms, 0)
    if entry_px is None or exit_px is None:
        return None
    if not (fp5.SCREEN_START_MS <= entry < fp5.SCREEN_END_MS):
        return None
    gross = exit_px / entry_px - 1.0
    net = fp5.net_return(entry_px, exit_px)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def signal_spans(spot: dict) -> list[tuple[int, int]]:
    """The finished week is strictly up. The span is not a profit."""
    out = []
    for entry in _days():
        week = _week(spot, entry)
        if week is None or week <= 0.0:
            continue
        trade = _long(entry, spot)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def pool_spans(spot: dict) -> list[tuple[int, int]]:
    """The same seven-day long on every day the two closes exist."""
    out = []
    for entry in _days():
        if _week(spot, entry) is None or _long(entry, spot) is None:
            continue
        out.append((entry, entry + HOLD_DAYS * fp5.DAY_MS))
    return out


def signal_trades(spot: dict) -> list[dict]:
    trades = []
    for entry, exit_ms in signal_spans(spot):
        trade = _long(entry, spot)
        if trade is None or trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        trades.append(trade)
    return trades


def pool_nets(spot: dict) -> list[float]:
    nets = []
    for entry, _exit_ms in pool_spans(spot):
        trade = _long(entry, spot)
        if trade is None:
            raise RuntimeError("a pool day did not fill")
        nets.append(trade["net"])
    return nets
