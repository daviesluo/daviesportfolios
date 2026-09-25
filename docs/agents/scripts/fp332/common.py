"""Spot against the front Binance USDT-M quarterly.

The buyer of the quarterly pays more than the Binance spot open for a
contract that must meet that coin at delivery. The scored result is how
many basis points that gap closes. It is not the move in the spot price.

Ten basis points a fill. The package is four fills, forty basis points.
The previous day's closes already show at least 100 bp. The same package
is the other trade when that gap is below 100 bp. The exit is the open on
the expiry day, which is 00:00 UTC, before the 08:00 delivery. The
settlement index is not read. No other venue is read.
"""

from __future__ import annotations

import importlib.util
from decimal import Decimal
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "fp5_common",
    Path(__file__).resolve().parents[1] / "fp5" / "common.py",
)
fp5 = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(fp5)

MIN_N = 30
COIN = "BTC"
IDEA = "SPQTR"
THRESHOLD_BPS = Decimal("100")
COST = Decimal("0.004")
NULL_KIND = "other_regime"
MODE = "regime"
RULE_BOOK = "um_quarterly"
RULE_SIDE = "short_basis"
FIELDS = ("coin", "book", "side", "entry_ms", "exit_ms", "gross", "net", "pnl")
RULE_N = 125
NULL_N = 240
FILLABLE_N = 365

# Delivery is the last Friday 08:00 UTC. The bar used is that day's 00:00 open.
EXPIRY = {
    "BTCUSDT_230331": 1680220800000,
    "BTCUSDT_230630": 1688083200000,
    "BTCUSDT_230929": 1695945600000,
    "BTCUSDT_231229": 1703808000000,
    "BTCUSDT_240329": 1711670400000,
}

if RULE_N < MIN_N or NULL_N < RULE_N:
    raise RuntimeError("the freeze is shorter than the count")
if COST != Decimal(str(fp5.FEE)) * 4:
    raise RuntimeError("the four-fill cost moved")


def _pair(bar: tuple) -> tuple[Decimal, Decimal]:
    if not isinstance(bar, tuple) or len(bar) != 2:
        raise SystemExit("a high or a low was read")
    opened, closed = Decimal(bar[0]), Decimal(bar[1])
    if opened <= 0 or closed <= 0:
        raise SystemExit("a bar is not a price")
    return opened, closed


def _bps(future: Decimal, spot: Decimal) -> Decimal:
    return (future - spot) / spot * Decimal(10000)


def _front(day: int, spot: dict, books: dict):
    prev = day - fp5.DAY_MS
    found = []
    for symbol, expiry in EXPIRY.items():
        if expiry <= day:
            continue
        book = books.get(symbol)
        if book is None:
            continue
        if prev not in book or day not in book or expiry not in book:
            continue
        if prev not in spot or day not in spot or expiry not in spot:
            continue
        found.append((expiry, symbol))
    if not found:
        return None
    found.sort()
    return found[0]


def paths(spot: dict, books: dict) -> list[dict]:
    """One row per 2023 entry day that has both opens and the expiry open."""
    rows = []
    day = fp5.SCREEN_START_MS
    while day < fp5.SCREEN_END_MS:
        chosen = _front(day, spot, books)
        if chosen is not None:
            expiry, symbol = chosen
            prev = day - fp5.DAY_MS
            signal = _bps(_pair(books[symbol][prev])[1], _pair(spot[prev])[1])
            entry_bps = _bps(_pair(books[symbol][day])[0], _pair(spot[day])[0])
            exit_bps = _bps(_pair(books[symbol][expiry])[0], _pair(spot[expiry])[0])
            gross = (entry_bps - exit_bps) / Decimal(10000)
            net = gross - COST
            rows.append(
                {
                    "coin": COIN,
                    "book": RULE_BOOK,
                    "side": RULE_SIDE,
                    "entry_ms": day,
                    "exit_ms": expiry,
                    "gross": float(gross),
                    "net": float(net),
                    "pnl": float(Decimal(100) * net),
                    "signal_bps": signal,
                    "entry_bps": entry_bps,
                    "exit_bps": exit_bps,
                    "on": signal >= THRESHOLD_BPS,
                }
            )
        day += fp5.DAY_MS
    return rows


def _public(row: dict) -> dict:
    return {key: row[key] for key in FIELDS}


def rule_trades(spot: dict, books: dict) -> list[dict]:
    return [_public(row) for row in paths(spot, books) if row["on"]]


def null_trades(spot: dict, books: dict) -> list[dict]:
    return [_public(row) for row in paths(spot, books) if not row["on"]]
