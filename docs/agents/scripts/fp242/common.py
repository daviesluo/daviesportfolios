"""The search fp242. A finished two-day USDT rise, then a nine-day spot short.

Nothing here reads the network or a file. The prints used by the signal have
already happened. The entry open is not an input. The position is one leg.
It is not a one-day trade and it is not an overnight trade. Funding cash is
not added. The null is that same 9-day short on every day.
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
IDEA = "UPRI"
HOLD_DAYS = 9

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


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


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


def _signal(um: dict, spot: dict, entry: int) -> bool:
    move = finished(um, entry, 2)
    if move is None:
        return False
    return move > 0.0


def _pool_day(entry: int) -> bool:
    return True


def signal_spans(um: dict, spot: dict) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        if not _signal(um, spot, entry):
            continue
        trade = _fill(entry, spot)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def pool_spans(um: dict, spot: dict) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        if not _pool_day(entry):
            continue
        trade = _fill(entry, spot)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def signal_trades(um: dict, spot: dict) -> list[dict]:
    trades = []
    for entry, exit_ms in signal_spans(um, spot):
        trade = _fill(entry, spot)
        if trade is None or trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        if trade["exit_ms"] - trade["entry_ms"] != HOLD_DAYS * fp5.DAY_MS:
            raise RuntimeError("the hold moved")
        trades.append(trade)
    return trades


def pool_nets(um: dict, spot: dict) -> list[float]:
    nets = []
    for entry, _exit_ms in pool_spans(um, spot):
        trade = _fill(entry, spot)
        if trade is None:
            raise RuntimeError("a pool day did not fill")
        nets.append(trade["net"])
    return nets
