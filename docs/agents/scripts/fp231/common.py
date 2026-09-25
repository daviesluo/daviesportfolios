"""The search fp231. A newly listed quarterly, held eleven days.

Nothing here reads the network or a file. The listing day is the previous
quarterly's expiry, which was fixed before that open. The position is the
most recently listed of the three 2023 quarterlies that opened inside this
window, bought during its first fourteen days and sold eleven days later,
still before its own expiry. The March contract's first fortnight is not
in this screen, so that contract is not here. It is not a one-day trade
and it is not an overnight trade. The perpetual is not a second leg.
Funding cash is not added. The null is that same eleven-day long on every
later day of that same contract.
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
IDEA = "QNEW"
HOLD_DAYS = 11
AGE_MAX = 13

# Listing midnight, expiry midnight, symbol. Listing is the previous expiry.
LISTED = (
    (1_672_358_400_000, 1_688_083_200_000, "BTCUSD_230630"),
    (1_680_220_800_000, 1_695_945_600_000, "BTCUSD_230929"),
    (1_688_083_200_000, 1_703_808_000_000, "BTCUSD_231229"),
)


def _days():
    t = fp5.SCREEN_START_MS
    while t < fp5.SCREEN_END_MS:
        yield t
        t += fp5.DAY_MS


def active(entry_ms: int) -> tuple[int, int, str] | None:
    """The latest listing that has already happened. None before the first."""
    chosen = None
    for listed, expiry, symbol in LISTED:
        if listed <= entry_ms:
            chosen = (listed, expiry, symbol)
    return chosen


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


def _span(entry: int, books: dict, young_only: bool) -> tuple[int, int] | None:
    found = active(entry)
    if found is None:
        return None
    listed, expiry, symbol = found
    age = (entry - listed) // fp5.DAY_MS
    if young_only and age > AGE_MAX:
        return None
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if exit_ms >= expiry:
        return None
    book = books.get(symbol)
    if book is None or _long(entry, exit_ms, book) is None:
        return None
    return entry, exit_ms


def signal_spans(books: dict) -> list[tuple[int, int]]:
    """The first fourteen days after listing. The span is the position."""
    out = []
    for entry in _days():
        span = _span(entry, books, True)
        if span is not None:
            out.append(span)
    return out


def pool_spans(books: dict) -> list[tuple[int, int]]:
    """The same eleven-day long on every later day of that contract."""
    out = []
    for entry in _days():
        span = _span(entry, books, False)
        if span is not None:
            out.append(span)
    return out


def _fill(entry: int, exit_ms: int, books: dict) -> dict:
    found = active(entry)
    if found is None:
        raise RuntimeError("a counted entry has no quarterly")
    trade = _long(entry, exit_ms, books[found[2]])
    if trade is None or trade["exit_ms"] != exit_ms:
        raise RuntimeError("a counted entry did not fill")
    if trade["exit_ms"] - trade["entry_ms"] != HOLD_DAYS * fp5.DAY_MS:
        raise RuntimeError("the hold is not eleven days")
    if trade["exit_ms"] >= found[1]:
        raise RuntimeError("the sale landed on expiry")
    return trade


def signal_trades(books: dict) -> list[dict]:
    return [_fill(entry, exit_ms, books) for entry, exit_ms in signal_spans(books)]


def pool_nets(books: dict) -> list[float]:
    return [_fill(entry, exit_ms, books)["net"] for entry, exit_ms in pool_spans(books)]
