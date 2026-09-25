"""The search fp307. Fair value is the BitMEX XBTUSD daily close. The finished coin-margined close was strictly under that close, so the next coin-margined open is a price that finished cheap to BitMEX. Buy the coin-margined book for seven days. The other trade buys the coin-margined book for seven days on these same prices when that discount is absent.

Nothing here reads the network or a file. The prints used by the signal have
already happened. Fair value is not computed from this contract's daily bars,
and it is not the Binance spot, coin-margined or USDT book. Coinbase and
Deribit are not reused. The entry open is not an input. A fill is an open on
the contract being traded. The position is one leg. It is not a one-day trade
and it is not an overnight trade. Funding cash is not added. The null is the
same leg with the price edge turned off. It is not the opposite side and it is
not an unconditional hold. A book ticker is not read.
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
IDEA = 'MEXCH'
HOLD_DAYS = 7
NULL_KIND = "other_regime"
MODE = "regime"
EDGE = 'cheap'
DISCOUNT = 0.0
WIDEN_LAG = 0
FAIR_KEY = 'mx'
FAIR_SHIFT_MS = 0
LOOKBACK_MS = 1667260800000
FAIR_LAST_MS = fp5.SCREEN_END_MS - fp5.DAY_MS + FAIR_SHIFT_MS
RULE_BOOK = 'cm'
NULL_BOOK = 'cm'
RULE_SIDE = 'long'
NULL_SIDE = 'long'
FILES = {
    RULE_BOOK: ('cm1d/BTCUSD_PERP.json', True),
    FAIR_KEY: ('mx1d/XBTUSD.json', False),
}
PULLS = [
    ('cm', 'BTCUSD_PERP', 'cm1d', True),
    ('mx', 'XBTUSD', 'mx1d', False),
]

if HOLD_DAYS <= 1:
    raise RuntimeError("the hold is one day or overnight")
if NULL_KIND != "other_regime" or MODE != "regime":
    raise RuntimeError("the edge-off trade is not this leg")
if RULE_BOOK != NULL_BOOK or RULE_SIDE != NULL_SIDE:
    raise RuntimeError("the edge-off trade changed the leg")
if RULE_SIDE == "long" and NULL_SIDE == "short":
    raise RuntimeError("the other trade is the opposite side")
if FAIR_KEY in ("spot", "um", "cm", "cb", "db") or FAIR_KEY == RULE_BOOK:
    raise RuntimeError("the fair value is a Binance line or a reused venue")
if EDGE not in ("cheap", "rich"):
    raise RuntimeError("the edge is not a price")
if WIDEN_LAG != 0:
    raise RuntimeError("this round does not slice one premium into a wider basis")
if FAIR_SHIFT_MS not in (0, 2 * fp5.EIGHT_H_MS):
    raise RuntimeError("the publication clock moved")
if LOOKBACK_MS >= fp5.SCREEN_START_MS:
    raise RuntimeError("the fair value has no lookback")
if FAIR_LAST_MS >= fp5.SCREEN_END_MS:
    raise RuntimeError("a later fair-value bar was kept")

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


def _named(spot: dict, um: dict, cm: dict, name: str) -> dict:
    if name == "spot":
        return spot
    if name == "um":
        return um
    if name == "cm":
        return cm
    raise RuntimeError("book")


def _fair_close(fair: dict, entry: int) -> float | None:
    """The latest external close whose bucket had already ended."""
    best = None
    for ts in fair:
        if ts + fp5.DAY_MS < entry and (best is None or ts > best):
            best = ts
    if best is None:
        return None
    return _px(fair, best, 1)


def _basis_at(traded: dict, fair: dict, entry: int) -> float | None:
    price = _px(traded, entry - fp5.DAY_MS, 1)
    value = _fair_close(fair, entry)
    if price is None or value is None:
        return None
    return price / value - 1.0


def _window(entry: int, book: dict):
    exit_ms = entry + HOLD_DAYS * fp5.DAY_MS
    if not (fp5.SCREEN_START_MS <= entry < fp5.SCREEN_END_MS):
        return None
    if exit_ms <= entry or exit_ms > fp5.SCREEN_END_MS:
        return None
    entry_px = _px(book, entry, 0)
    exit_px = _px(book, exit_ms, 0)
    if entry_px is None or exit_px is None:
        return None
    return entry_px, exit_px, exit_ms


def _rule_signal(spot, um, cm, fair, entry) -> bool:
    traded = _named(spot, um, cm, RULE_BOOK)
    basis = _basis_at(traded, fair, entry)
    if basis is None:
        return False
    if EDGE == "cheap":
        return basis < -DISCOUNT
    if EDGE == "rich":
        return basis > DISCOUNT
    if EDGE == "widen":
        old = _basis_at(traded, fair, entry - WIDEN_LAG * fp5.DAY_MS)
        if old is None:
            return False
        return basis > DISCOUNT and basis > old
    raise RuntimeError("edge")


def _null_signal(spot, um, cm, fair, entry) -> bool:
    traded = _named(spot, um, cm, RULE_BOOK)
    basis = _basis_at(traded, fair, entry)
    if basis is None:
        return False
    return not _rule_signal(spot, um, cm, fair, entry)


def _rule_on(spot, um, cm, fair, entry) -> bool:
    return _rule_signal(spot, um, cm, fair, entry)


def _null_on(spot, um, cm, fair, entry) -> bool:
    return _null_signal(spot, um, cm, fair, entry)


def rule_spans(spot, um, cm, fair) -> list[tuple[int, int]]:
    out = []
    traded = _named(spot, um, cm, RULE_BOOK)
    for entry in _days():
        if not _rule_on(spot, um, cm, fair, entry):
            continue
        if _window(entry, traded) is None:
            continue
        out.append((entry, entry + HOLD_DAYS * fp5.DAY_MS))
    return out


def null_spans(spot, um, cm, fair) -> list[tuple[int, int]]:
    out = []
    traded = _named(spot, um, cm, NULL_BOOK)
    for entry in _days():
        if not _null_on(spot, um, cm, fair, entry):
            continue
        if _window(entry, traded) is None:
            continue
        out.append((entry, entry + HOLD_DAYS * fp5.DAY_MS))
    return out


def fillable(book: dict) -> int:
    n = 0
    for entry in _days():
        if _window(entry, book) is not None:
            n += 1
    return n


def short_net(entry: float, exit_px: float, fee: float = fp5.FEE) -> float:
    if entry <= 0.0 or exit_px <= 0.0:
        raise ValueError("a fill needs a positive price")
    sold = entry * (1.0 - fee)
    bought = exit_px * (1.0 + fee)
    return sold / bought - 1.0


def _trade(entry: int, book_name: str, book: dict, side: str) -> dict:
    window = _window(entry, book)
    if window is None:
        raise RuntimeError("a counted entry did not fill")
    entry_px, exit_px, exit_ms = window
    if side == "long":
        gross = exit_px / entry_px - 1.0
        net = fp5.net_return(entry_px, exit_px)
    elif side == "short":
        gross = entry_px / exit_px - 1.0
        net = short_net(entry_px, exit_px)
    else:
        raise RuntimeError("side")
    if exit_ms - entry != HOLD_DAYS * fp5.DAY_MS:
        raise RuntimeError("the hold moved")
    return {
        "coin": COIN,
        "book": book_name,
        "side": side,
        "entry_ms": entry,
        "exit_ms": exit_ms,
        "gross": gross,
        "net": net,
        "pnl": 100.0 * net,
    }


def rule_trades(spot, um, cm, fair) -> list[dict]:
    book = _named(spot, um, cm, RULE_BOOK)
    trades = []
    for entry, exit_ms in rule_spans(spot, um, cm, fair):
        trade = _trade(entry, RULE_BOOK, book, RULE_SIDE)
        if trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        trades.append(trade)
    return trades


def null_trades(spot, um, cm, fair) -> list[dict]:
    book = _named(spot, um, cm, NULL_BOOK)
    trades = []
    for entry, exit_ms in null_spans(spot, um, cm, fair):
        trade = _trade(entry, NULL_BOOK, book, NULL_SIDE)
        if trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted null did not fill")
        trades.append(trade)
    return trades
