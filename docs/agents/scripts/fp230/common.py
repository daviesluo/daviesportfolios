"""The search fp230. A finished coin-margined decline that also lagged spot.

Nothing here reads the network or a file. Both twelve-day returns end at
yesterday's close. The coin-margined return is negative, and it is below
the spot return. The entry open is not an input. Spot is a signal, not a
second leg. The position is one coin-margined leg, bought at the next open
and sold twelve days later. It is not a one-day trade and it is not an
overnight trade. Funding cash is not added. The null is that same
twelve-day long on every day.
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
IDEA = "CMF"
HOLD_DAYS = 12
LOOKBACK = 12


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


def _long(entry: int, cm: dict) -> dict | None:
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if not (fp5.SCREEN_START_MS <= entry < fp5.SCREEN_END_MS):
        return None
    if exit_ms <= entry or exit_ms > fp5.SCREEN_END_MS:
        return None
    entry_px = _px(cm, entry, 0)
    exit_px = _px(cm, exit_ms, 0)
    if entry_px is None or exit_px is None:
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


def _split(cm: dict, spot: dict, entry: int) -> bool:
    cm_move = finished(cm, entry, 1)
    spot_move = finished(spot, entry, 0)
    if cm_move is None or spot_move is None:
        return False
    return cm_move < 0.0 and cm_move < spot_move


def signal_spans(cm: dict, spot: dict) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        if not _split(cm, spot, entry):
            continue
        trade = _long(entry, cm)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def pool_spans(cm: dict) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        trade = _long(entry, cm)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def signal_trades(cm: dict, spot: dict) -> list[dict]:
    trades = []
    for entry, exit_ms in signal_spans(cm, spot):
        trade = _long(entry, cm)
        if trade is None or trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        if trade["exit_ms"] - trade["entry_ms"] != HOLD_DAYS * fp5.DAY_MS:
            raise RuntimeError("the hold is not twelve days")
        trades.append(trade)
    return trades


def pool_nets(cm: dict) -> list[float]:
    nets = []
    for entry, _exit_ms in pool_spans(cm):
        trade = _long(entry, cm)
        if trade is None:
            raise RuntimeError("a pool day did not fill")
        nets.append(trade["net"])
    return nets
