"""The search fp229. Spot led the perpetual, then a fourteen-day spot short.

Nothing here reads the network or a file. Both ten-day returns end at
yesterday's close. The entry open is not an input. The USDT book is a
signal, not a second leg. The position is one spot leg, sold at the next
open and bought back fourteen days later. It is not a one-day trade and
it is not an overnight trade. Funding cash is not added. The null is that
same fourteen-day spot short on every day.
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
IDEA = "SLD"
HOLD_DAYS = 14
LOOKBACK = 10


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


def _days():
    t = fp5.SCREEN_START_MS
    while t < fp5.SCREEN_END_MS:
        yield t
        t += fp5.DAY_MS


def _px(book: dict, ts: int, index: int) -> float | None:
    row = book.get(ts)
    if row is None or len(row) <= index:
        return None
    px = float(row[index])
    if px <= 0.0:
        return None
    return px


def finished(book: dict, entry: int, index: int) -> float | None:
    end = entry - fp5.DAY_MS
    start = end - LOOKBACK * fp5.DAY_MS
    older = _px(book, start, index)
    newer = _px(book, end, index)
    if older is None or newer is None:
        return None
    return newer / older - 1.0


def _short(entry: int, spot: dict) -> dict | None:
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if not (fp5.SCREEN_START_MS <= entry < fp5.SCREEN_END_MS):
        return None
    if exit_ms <= entry or exit_ms > fp5.SCREEN_END_MS:
        return None
    entry_px = _px(spot, entry, 0)
    exit_px = _px(spot, exit_ms, 0)
    if entry_px is None or exit_px is None:
        return None
    gross = entry_px / exit_px - 1.0
    net = short_net(entry_px, exit_px)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def _led(spot: dict, um: dict, entry: int) -> bool:
    spot_move = finished(spot, entry, 1)
    um_move = finished(um, entry, 0)
    if spot_move is None or um_move is None:
        return False
    return spot_move > um_move


def signal_spans(spot: dict, um: dict) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        if not _led(spot, um, entry):
            continue
        trade = _short(entry, spot)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def pool_spans(spot: dict) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        trade = _short(entry, spot)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def signal_trades(spot: dict, um: dict) -> list[dict]:
    trades = []
    for entry, exit_ms in signal_spans(spot, um):
        trade = _short(entry, spot)
        if trade is None or trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        if trade["exit_ms"] - trade["entry_ms"] != HOLD_DAYS * fp5.DAY_MS:
            raise RuntimeError("the hold is not fourteen days")
        trades.append(trade)
    return trades


def pool_nets(spot: dict) -> list[float]:
    nets = []
    for entry, _exit_ms in pool_spans(spot):
        trade = _short(entry, spot)
        if trade is None:
            raise RuntimeError("a pool day did not fill")
        nets.append(trade["net"])
    return nets
