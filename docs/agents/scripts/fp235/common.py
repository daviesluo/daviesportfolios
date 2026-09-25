"""The search fp235. Spot, the USDT perpetual and the coin-margined perpetual all finished a six-day rise, then a seven-day coin-margined long.

Nothing here reads the network or a file. The three six-day returns end at yesterday's close. The entry open is not an input. Spot and the USDT book are signals. The position is one
leg. It is not a one-day trade and it is not an overnight trade. Funding
cash is not added. The null is that same 7-day long on every
day.
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
IDEA = "TRI"
HOLD_DAYS = 7

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


def finished(book: dict, entry: int, lookback: int) -> float | None:
    end = entry - fp5.DAY_MS
    start = end - lookback * fp5.DAY_MS
    older = _px(book, start, 1)
    newer = _px(book, end, 1)
    if older is None or newer is None:
        return None
    return newer / older - 1.0



def _fill(entry: int, book: dict) -> dict | None:
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if not (fp5.SCREEN_START_MS <= entry < fp5.SCREEN_END_MS):
        return None
    if exit_ms <= entry or exit_ms > fp5.SCREEN_END_MS:
        return None
    entry_px = _px(book, entry, 0)
    exit_px = _px(book, exit_ms, 0)
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



def _signal(spot: dict, um: dict, cm: dict, entry: int) -> bool:
    moves = [finished(book, entry, 6) for book in (spot, um, cm)]
    return all(move is not None and move > 0.0 for move in moves)


def _pool_day(entry: int) -> bool:
    return True


def signal_spans(spot: dict, um: dict, cm: dict) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        if not _signal(spot, um, cm, entry):
            continue
        trade = _fill(entry, cm)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def pool_spans(spot: dict, um: dict, cm: dict) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        if not _pool_day(entry):
            continue
        trade = _fill(entry, cm)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def signal_trades(spot: dict, um: dict, cm: dict) -> list[dict]:
    trades = []
    for entry, exit_ms in signal_spans(spot, um, cm):
        trade = _fill(entry, cm)
        if trade is None or trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        if trade["exit_ms"] - trade["entry_ms"] != HOLD_DAYS * fp5.DAY_MS:
            raise RuntimeError("the hold moved")
        trades.append(trade)
    return trades


def pool_nets(spot: dict, um: dict, cm: dict) -> list[float]:
    nets = []
    for entry, _exit_ms in pool_spans(spot, um, cm):
        trade = _fill(entry, cm)
        if trade is None:
            raise RuntimeError("a pool day did not fill")
        nets.append(trade["net"])
    return nets
