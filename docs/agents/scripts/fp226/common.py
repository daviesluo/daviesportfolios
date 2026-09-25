"""The search fp226. A finished pullback inside a longer rise, then ten days.

Nothing here reads the network or a file. Both returns use closes that
have already printed: yesterday against twenty days earlier, and yesterday
against five days earlier. The entry open is not an input. The position
is one spot leg, bought at the next open and sold ten days later. It is
not a one-day trade and it is not an overnight trade. Funding cash is
not added. The null is that same ten-day spot long on every day.
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
IDEA = "PBK"
HOLD_DAYS = 10
SLOW = 20
FAST = 5


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
    """Close yesterday over the close `lookback` days before that. Not today's open."""
    end = entry - fp5.DAY_MS
    start = end - lookback * fp5.DAY_MS
    older = _px(book, start, 1)
    newer = _px(book, end, 1)
    if older is None or newer is None:
        return None
    return newer / older - 1.0


def _long(entry: int, book: dict) -> dict | None:
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


def _pullback(book: dict, entry: int) -> bool:
    slow = finished(book, entry, SLOW)
    fast = finished(book, entry, FAST)
    if slow is None or fast is None:
        return False
    return slow > 0.0 and fast < 0.0


def signal_spans(spot: dict) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        if not _pullback(spot, entry):
            continue
        trade = _long(entry, spot)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def pool_spans(spot: dict) -> list[tuple[int, int]]:
    out = []
    for entry in _days():
        trade = _long(entry, spot)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def signal_trades(spot: dict) -> list[dict]:
    trades = []
    for entry, exit_ms in signal_spans(spot):
        trade = _long(entry, spot)
        if trade is None or trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        if trade["exit_ms"] - trade["entry_ms"] != HOLD_DAYS * fp5.DAY_MS:
            raise RuntimeError("the hold is not ten days")
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
