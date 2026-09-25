"""The search fp269. A finished nine-day spot rise had already ended, and the latest nine-day spot return was not a rise. Buy the coin-margined book for five days. The other trade buys the USDT book for those same five days.

Nothing here reads the network or a file. The prints used by the signal have
already happened. The entry open is not an input. A fill is an open on the
contract being traded. The position is one leg. It is not a one-day trade and
it is not an overnight trade. Funding cash is not added. The null is another
trade held the same number of days. It is not this leg with the condition off.
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
IDEA = 'STALE'
HOLD_DAYS = 5
NULL_KIND = 'other_book'
MODE = 'paired'
RULE_BOOK = 'cm'
NULL_BOOK = 'um'
RULE_SIDE = 'long'
NULL_SIDE = 'long'
FILES = {'spot': ('spot1d/BTCUSDT.json', False), 'um': ('um1d/BTCUSDT.json', True), 'cm': ('cm1d/BTCUSD_PERP.json', True)}
PULLS = [('spot', 'BTCUSDT', 'spot1d', False), ('um', 'BTCUSDT', 'um1d', True), ('cm', 'BTCUSD_PERP', 'cm1d', True)]

if HOLD_DAYS <= 1:
    raise RuntimeError("the hold is one day or overnight")
if NULL_KIND not in {"other_book", "other_side", "other_time", "other_regime"}:
    raise RuntimeError("the null is not another trade")
if NULL_KIND == "other_book" and RULE_BOOK == NULL_BOOK:
    raise RuntimeError("the books did not differ")
if NULL_KIND == "other_side" and (RULE_SIDE == NULL_SIDE or RULE_BOOK != NULL_BOOK):
    raise RuntimeError("the sides did not differ")
if NULL_KIND == "other_time" and MODE != "shifted":
    raise RuntimeError("the later trade is not delayed")
if NULL_KIND == "other_regime" and MODE != "regime":
    raise RuntimeError("the regimes collapsed")
if MODE == "shifted" and (RULE_BOOK != NULL_BOOK or RULE_SIDE != NULL_SIDE):
    raise RuntimeError("the later trade changed the leg")
if MODE == "regime" and (RULE_BOOK != NULL_BOOK or RULE_SIDE != NULL_SIDE):
    raise RuntimeError("the other regime changed the leg")


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


def _named(spot: dict, um: dict, cm: dict, name: str) -> dict:
    if name == "spot":
        return spot
    if name == "um":
        return um
    if name == "cm":
        return cm
    raise RuntimeError("book")


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

def _signal(spot, um, cm, entry) -> bool:
    old = finished(spot, entry - 9 * fp5.DAY_MS, 9)
    near = finished(spot, entry, 9)
    return old is not None and near is not None and old > 0.0 and near <= 0.0


def _rule_signal(spot, um, cm, entry) -> bool:
    raise RuntimeError("this rule has one signal")


def _null_signal(spot, um, cm, entry) -> bool:
    raise RuntimeError("this rule has one signal")

def _rule_on(spot, um, cm, entry) -> bool:
    if MODE == "regime":
        return _rule_signal(spot, um, cm, entry)
    return _signal(spot, um, cm, entry)


def _null_on(spot, um, cm, entry) -> bool:
    if MODE == "regime":
        return _null_signal(spot, um, cm, entry)
    return False


def rule_spans(spot, um, cm) -> list[tuple[int, int]]:
    out = []
    rule_book = _named(spot, um, cm, RULE_BOOK)
    null_book = _named(spot, um, cm, NULL_BOOK)
    for entry in _days():
        if not _rule_on(spot, um, cm, entry):
            continue
        if _window(entry, rule_book) is None:
            continue
        if MODE == "shifted":
            if _window(entry + HOLD_DAYS * fp5.DAY_MS, rule_book) is None:
                continue
        elif MODE == "paired":
            if _window(entry, null_book) is None:
                continue
        out.append((entry, entry + HOLD_DAYS * fp5.DAY_MS))
    return out


def null_spans(spot, um, cm) -> list[tuple[int, int]]:
    if MODE == "shifted":
        shift = HOLD_DAYS * fp5.DAY_MS
        return [(entry + shift, exit_ms + shift) for entry, exit_ms in rule_spans(spot, um, cm)]
    if MODE == "paired":
        return list(rule_spans(spot, um, cm))
    out = []
    book = _named(spot, um, cm, NULL_BOOK)
    for entry in _days():
        if not _null_on(spot, um, cm, entry):
            continue
        if _window(entry, book) is None:
            continue
        out.append((entry, entry + HOLD_DAYS * fp5.DAY_MS))
    return out


def fillable(book: dict) -> int:
    n = 0
    for entry in _days():
        if _window(entry, book) is not None:
            n += 1
    return n


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


def rule_trades(spot, um, cm) -> list[dict]:
    book = _named(spot, um, cm, RULE_BOOK)
    trades = []
    for entry, exit_ms in rule_spans(spot, um, cm):
        trade = _trade(entry, RULE_BOOK, book, RULE_SIDE)
        if trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted entry did not fill")
        trades.append(trade)
    return trades


def null_trades(spot, um, cm) -> list[dict]:
    book = _named(spot, um, cm, NULL_BOOK)
    trades = []
    for entry, exit_ms in null_spans(spot, um, cm):
        trade = _trade(entry, NULL_BOOK, book, NULL_SIDE)
        if trade["exit_ms"] != exit_ms:
            raise RuntimeError("a counted null did not fill")
        trades.append(trade)
    return trades
