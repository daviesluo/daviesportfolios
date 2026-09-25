"""The search fp218. The first week of the month is held to the next month.

Nothing here reads the network or a file. The day of the month is known
before that open. The position is one USDT-perpetual leg, bought on a
UTC day numbered 1 through 7 and sold at the next month's first open.
The hold is 22 to 31 days. It is not a one-day trade and it is not an
overnight trade. Funding cash is not added. The null is the same sale,
on every day whose hold to that open is at least seven days.
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
IDEA = "MTH"
HOLD_MIN = 22
HOLD_MAX = 31
POOL_MIN = 7


def _utc(ms: int) -> datetime:
    stamp = datetime.fromtimestamp(ms / 1000, timezone.utc)
    if stamp.hour or stamp.minute or stamp.second or stamp.microsecond:
        raise ValueError("a session bar is midnight UTC")
    return stamp


def _next_month(ms: int) -> int:
    stamp = _utc(ms)
    year = stamp.year + (1 if stamp.month == 12 else 0)
    month = 1 if stamp.month == 12 else stamp.month + 1
    nxt = datetime(year, month, 1, tzinfo=timezone.utc)
    return int(nxt.timestamp() * 1000)


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


def _long(entry: int, exit_ms: int, book: dict) -> dict | None:
    entry_px = _open(book, entry)
    exit_px = _open(book, exit_ms)
    if entry_px is None or exit_px is None:
        return None
    if not (fp5.SCREEN_START_MS <= entry < fp5.SCREEN_END_MS):
        return None
    if exit_ms <= entry or exit_ms > fp5.SCREEN_END_MS:
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


def _eligible(entry: int, book: dict, minimum: int) -> tuple[int, int] | None:
    exit_ms = _next_month(entry)
    hold = (exit_ms - entry) // fp5.DAY_MS
    if hold < minimum or exit_ms > fp5.SCREEN_END_MS:
        return None
    if _long(entry, exit_ms, book) is None:
        return None
    return entry, exit_ms


def signal_spans(um: dict) -> list[tuple[int, int]]:
    """Days 1 through 7. The span is the position, not a profit."""
    out = []
    for entry in _days():
        if _utc(entry).day > 7:
            continue
        span = _eligible(entry, um, HOLD_MIN)
        if span is None:
            continue
        out.append(span)
    return out


def pool_spans(um: dict) -> list[tuple[int, int]]:
    """Every day held to the next month's open, when at least seven days remain."""
    out = []
    for entry in _days():
        span = _eligible(entry, um, POOL_MIN)
        if span is None:
            continue
        out.append(span)
    return out


def signal_trades(um: dict) -> list[dict]:
    trades = []
    for entry, exit_ms in signal_spans(um):
        trade = _long(entry, exit_ms, um)
        if trade is None:
            raise RuntimeError("a counted entry did not fill")
        hold = (trade["exit_ms"] - trade["entry_ms"]) // fp5.DAY_MS
        if hold < HOLD_MIN or hold > HOLD_MAX:
            raise RuntimeError("the month hold moved")
        trades.append(trade)
    return trades


def pool_nets(um: dict) -> list[float]:
    nets = []
    for entry, exit_ms in pool_spans(um):
        trade = _long(entry, exit_ms, um)
        if trade is None:
            raise RuntimeError("a pool day did not fill")
        nets.append(trade["net"])
    return nets
