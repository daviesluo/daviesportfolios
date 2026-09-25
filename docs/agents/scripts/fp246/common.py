"""The search fp246. Three finished two-day spot rises, then a three-day coin-margined long.

Nothing here reads the network or a file. The prints used by the signal have
already happened. The entry open is not an input. The position is one leg.
It is not a one-day trade and it is not an overnight trade. Funding cash is
not added. The null is that same 3-day long on every day.
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
IDEA = "TRIP"
HOLD_DAYS = 3

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


def _signal(spot: dict, cm: dict, entry: int) -> bool:
    first = finished(spot, entry, 2)
    second = finished(spot, entry - 2 * fp5.DAY_MS, 2)
    third = finished(spot, entry - 4 * fp5.DAY_MS, 2)
    if first is None or second is None or third is None:
        return False
    return first > 0.0 and second > 0.0 and third > 0.0


def _pool_day(entry: int) -> bool:
    return True


def signal_spans(spot: dict, cm: dict) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        if not _signal(spot, cm, entry):
            continue
        trade = _fill(entry, cm)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def pool_spans(spot: dict, cm: dict) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        if not _pool_day(entry):
            continue
        trade = _fill(entry, cm)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def signal_trades(spot: dict, cm: dict) -> list[dict]:
    trades = []
    for entry, exit_ms in signal_spans(spot, cm):
        trade = _fill(entry, cm)
        if trade is None or trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        if trade["exit_ms"] - trade["entry_ms"] != HOLD_DAYS * fp5.DAY_MS:
            raise RuntimeError("the hold moved")
        trades.append(trade)
    return trades


def pool_nets(spot: dict, cm: dict) -> list[float]:
    nets = []
    for entry, _exit_ms in pool_spans(spot, cm):
        trade = _fill(entry, cm)
        if trade is None:
            raise RuntimeError("a pool day did not fill")
        nets.append(trade["net"])
    return nets
