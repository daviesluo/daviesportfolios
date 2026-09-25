"""The search fp219. The front quarterly is held to its own expiry.

Nothing here reads the network or a file. The expiry date was fixed when
the contract was listed. The position is that one quarterly, bought when
seven to thirty-five days remain and sold at the expiry day's open. It
is not a one-day trade and it is not an overnight trade. The perpetual
is not a second leg. Funding cash is not added. The null is the same
hold to expiry on every day at least seven days remain.
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
IDEA = "XEXP"
DTE_MIN = 7
DTE_MAX = 35

# Expiry midnight UTC, then the symbol. The March 2024 contract is not here:
# its expiry is a later year. On the expiry day the expiring contract is
# still the front, and a same-day hold is not this rule.
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
    if row is None:
        return None
    if len(row) < 1:
        raise ValueError("a bar has no open")
    px = float(row[0])
    if px <= 0.0:
        return None
    return px


def _long(entry: int, expiry: int, book: dict) -> dict | None:
    entry_px = _open(book, entry)
    exit_px = _open(book, expiry)
    if entry_px is None or exit_px is None:
        return None
    if not (fp5.SCREEN_START_MS <= entry < fp5.SCREEN_END_MS):
        return None
    if expiry <= entry or expiry > fp5.SCREEN_END_MS:
        return None
    gross = exit_px / entry_px - 1.0
    net = fp5.net_return(entry_px, exit_px)
    return {
        "coin": COIN,
        "entry_ms": entry,
        "exit_ms": expiry,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def _candidate(entry: int, books: dict, dte_max: int | None) -> tuple[int, int] | None:
    found = front(entry)
    if found is None:
        return None
    expiry, symbol = found
    dte = (expiry - entry) // fp5.DAY_MS
    if dte < DTE_MIN:
        return None
    if dte_max is not None and dte > dte_max:
        return None
    book = books.get(symbol)
    if book is None or _long(entry, expiry, book) is None:
        return None
    return entry, expiry


def signal_spans(books: dict) -> list[tuple[int, int]]:
    """Seven to thirty-five days before expiry. The span is not a profit."""
    out = []
    for entry in _days():
        span = _candidate(entry, books, DTE_MAX)
        if span is None:
            continue
        out.append(span)
    return out


def pool_spans(books: dict) -> list[tuple[int, int]]:
    """Hold to expiry whenever at least seven days remain."""
    out = []
    for entry in _days():
        span = _candidate(entry, books, None)
        if span is None:
            continue
        out.append(span)
    return out


def signal_trades(books: dict) -> list[dict]:
    trades = []
    for entry, expiry in signal_spans(books):
        found = front(entry)
        if found is None:
            raise RuntimeError("the front contract disappeared")
        trade = _long(entry, expiry, books[found[1]])
        if trade is None:
            raise RuntimeError("a counted entry did not fill")
        hold = (trade["exit_ms"] - trade["entry_ms"]) // fp5.DAY_MS
        if hold < DTE_MIN or hold > DTE_MAX:
            raise RuntimeError("the expiry hold moved")
        trades.append(trade)
    return trades


def pool_nets(books: dict) -> list[float]:
    nets = []
    for entry, expiry in pool_spans(books):
        found = front(entry)
        if found is None:
            raise RuntimeError("the front contract disappeared")
        trade = _long(entry, expiry, books[found[1]])
        if trade is None:
            raise RuntimeError("a pool day did not fill")
        nets.append(trade["net"])
    return nets
