"""The search fp222. Buy Friday's open, sell the next Friday's open.

Nothing here reads the network or a file. Friday's date is known before
that open. The position is one USDT-perpetual leg, held seven days. The
weekend sits inside the hold. It is not a one-day trade and it is not
an overnight trade. It is not the Monday-to-Friday position. Funding
cash is not added. The null is that same seven-day long on every day,
not only Fridays.
"""

from __future__ import annotations

import importlib.util
from datetime import datetime, timezone
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "fp5_common",
    Path(__file__).resolve().parents[1] / "fp5" / "common.py",
)
fp5 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(fp5)

MIN_N = 30
COIN = "BTCUSDT"
IDEA = "FRI7"
HOLD_DAYS = 7


def _utc(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


def _days():
    t = fp5.SCREEN_START_MS
    while t < fp5.SCREEN_END_MS:
        yield t
        t += fp5.DAY_MS


def _open(book: dict, ts: int) -> float | None:
    row = book.get(ts)
    if row is None:
        return None
    if len(row) < 1:
        raise ValueError("a bar has no open")
    px = float(row[0])
    if px <= 0.0:
        return None
    return px


def _long(entry: int, book: dict) -> dict | None:
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if exit_ms > fp5.SCREEN_END_MS:
        return None
    entry_px = _open(book, entry)
    exit_px = _open(book, exit_ms)
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


def signal_spans(um: dict) -> list[tuple[int, int]]:
    """Friday entries. The span is the position, not a profit."""
    out = []
    for entry in _days():
        if _utc(entry).weekday() != 4:
            continue
        trade = _long(entry, um)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def pool_spans(um: dict) -> list[tuple[int, int]]:
    """The same seven-day long on every day the two opens exist."""
    out = []
    for entry in _days():
        trade = _long(entry, um)
        if trade is None:
            continue
        out.append((entry, trade["exit_ms"]))
    return out


def signal_trades(um: dict) -> list[dict]:
    trades = []
    for entry, exit_ms in signal_spans(um):
        trade = _long(entry, um)
        if trade is None or trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        if trade["exit_ms"] - trade["entry_ms"] != HOLD_DAYS * fp5.DAY_MS:
            raise RuntimeError("the hold is not seven days")
        trades.append(trade)
    return trades


def pool_nets(um: dict) -> list[float]:
    nets = []
    for entry, _exit_ms in pool_spans(um):
        trade = _long(entry, um)
        if trade is None:
            raise RuntimeError("a pool day did not fill")
        nets.append(trade["net"])
    return nets
