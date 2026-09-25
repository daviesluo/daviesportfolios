"""The search fp225. The front quarterly, held ten days, not to expiry.

Nothing here reads the network or a file. The expiry was fixed when the
contract was listed, so the days that remain are known before the open.
The position is that one quarterly. It is bought when 21 to 35 days remain
and sold ten days later, still before expiry. It is not a one-day trade
and it is not an overnight trade. The perpetual is not a second leg.
Funding cash is not added. The null is that same ten-day long on every
day the sale still lands before expiry.
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
IDEA = "QFAR"
HOLD_DAYS = 10
DTE_MIN = 21
DTE_MAX = 35
POOL_DTE = 11

# Expiry midnight UTC, then the symbol. The March 2024 contract is not here.
QUARTERS = (
    (1_680_220_800_000, "BTCUSD_230331"),
    (1_688_083_200_000, "BTCUSD_230630"),
    (1_695_945_600_000, "BTCUSD_230929"),
    (1_703_808_000_000, "BTCUSD_231229"),
)


def _days():
    t = fp5.SCREEN_START_MS
    while t < fp5.SCREEN_END_MS:
        yield t
        t += fp5.DAY_MS


def front(entry_ms: int) -> tuple[int, str] | None:
    """The nearest quarterly whose expiry is on or after the entry day."""
    for expiry, symbol in QUARTERS:
        if expiry >= entry_ms:
            return expiry, symbol
    return None


def _open(book: dict, ts: int) -> float | None:
    row = book.get(ts)
    if row is None or len(row) < 1:
        return None
    px = float(row[0])
    if px <= 0.0:
        return None
    return px


def _long(entry: int, exit_ms: int, book: dict) -> dict | None:
    if not (fp5.SCREEN_START_MS <= entry < fp5.SCREEN_END_MS):
        return None
    if exit_ms <= entry or exit_ms > fp5.SCREEN_END_MS:
        return None
    entry_px = _open(book, entry)
    exit_px = _open(book, exit_ms)
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


def _span(entry: int, books: dict, dte_min: int, dte_max: int) -> tuple[int, int] | None:
    found = front(entry)
    if found is None:
        return None
    expiry, symbol = found
    dte = (expiry - entry) // fp5.DAY_MS
    if dte < dte_min or dte > dte_max:
        return None
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if exit_ms >= expiry:
        return None
    book = books.get(symbol)
    if book is None or _long(entry, exit_ms, book) is None:
        return None
    return entry, exit_ms


def signal_spans(books: dict) -> list[tuple[int, int]]:
    """Twenty-one to thirty-five days left. The span is the position."""
    out = []
    for entry in _days():
        span = _span(entry, books, DTE_MIN, DTE_MAX)
        if span is not None:
            out.append(span)
    return out


def pool_spans(books: dict) -> list[tuple[int, int]]:
    """The same ten-day long whenever the sale is still before expiry."""
    out = []
    for entry in _days():
        span = _span(entry, books, POOL_DTE, 10_000)
        if span is not None:
            out.append(span)
    return out


def _fill(entry: int, exit_ms: int, books: dict) -> dict:
    found = front(entry)
    if found is None:
        raise RuntimeError("a counted entry has no quarterly")
    trade = _long(entry, exit_ms, books[found[1]])
    if trade is None or trade["exit_ms"] != exit_ms:
        raise RuntimeError("a counted entry did not fill")
    if trade["exit_ms"] - trade["entry_ms"] != HOLD_DAYS * fp5.DAY_MS:
        raise RuntimeError("the hold is not ten days")
    if trade["exit_ms"] >= found[0]:
        raise RuntimeError("the sale landed on expiry")
    return trade


def signal_trades(books: dict) -> list[dict]:
    return [_fill(entry, exit_ms, books) for entry, exit_ms in signal_spans(books)]


def pool_nets(books: dict) -> list[float]:
    return [_fill(entry, exit_ms, books)["net"] for entry, exit_ms in pool_spans(books)]
