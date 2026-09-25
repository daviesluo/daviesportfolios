from __future__ import annotations

"""Pins for one published-price rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _long(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def _level(fair_target: Decimal) -> dict[str, Decimal]:
    if c.FAIR_KIND == "quote":
        return {"usd": fair_target, "busd": Decimal(1)}
    us = c.US0 * fair_target / c.BASE_FX
    return {"us": us, "ea": c.EA0, "busd": Decimal(1)}


def _put(parts: dict, stamp: int, fair_target: Decimal) -> None:
    for name, value in _level(fair_target).items():
        parts[name][stamp] = value


def test_rule() -> None:
    if c.HOLD_DAYS != 2 or c.NULL_KIND != "other_regime" or c.MODE != "regime":
        raise SystemExit("the idea moved")
    if c.RULE_SIDE != "long" or c.RULE_BOOK != "spot" or c.NULL_SIDE != "long":
        raise SystemExit("the leg moved")
    if c.FAIR_KIND == "quote":
        if c.READY_MS != 0 or set(c.PARTS) != {"usd", "busd"}:
            raise SystemExit("the quote is not named")
    elif c.FAIR_KIND == "relative":
        if c.READY_MS <= c.fp5.SCREEN_START_MS or c.BASE_FX != Decimal("1.0666"):
            raise SystemExit("the relative price is not named")
        if set(c.PARTS) != {"us", "ea", "busd"} or c.US0 <= 0 or c.EA0 <= 0:
            raise SystemExit("the relative price is not named")
    else:
        raise SystemExit("the fair value is not named")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 120 * day
    off = entry + 40 * day
    hole = entry + 60 * day
    close = Decimal(100)
    exact = close * (Decimal(10000) + c.THRESHOLD_BPS) / Decimal(10000)
    under = close * (Decimal(10000) + c.THRESHOLD_BPS - 1) / Decimal(10000)
    book = {}
    parts = {name: {} for name in c.PARTS}
    book[entry - day] = (Decimal("100"), close)
    book[entry] = (Decimal("50"), Decimal("200"))
    book[entry + c.HOLD_DAYS * day] = (Decimal("55"), Decimal("200"))
    book[off - day] = (Decimal("10"), close)
    book[off] = (Decimal("40"), Decimal("50"))
    book[off + c.HOLD_DAYS * day] = (Decimal("42"), Decimal("50"))
    book[hole] = (Decimal("70"), Decimal("70"))
    book[hole + c.HOLD_DAYS * day] = (Decimal("71"), Decimal("71"))
    _put(parts, entry - day, exact)
    _put(parts, entry, Decimal(1))
    _put(parts, off - day, under)
    _put(parts, hole - 1000, exact)

    rules = c.rule_trades(book, parts)
    nulls = c.null_trades(book, parts)
    if [t["entry_ms"] for t in rules] != [entry] or rules[0]["book"] != "spot" or rules[0]["side"] != "long":
        raise SystemExit("the price edge was not the traded leg")
    if [t["entry_ms"] for t in nulls] != [off] or nulls[0]["side"] != "long" or nulls[0]["book"] != "spot":
        raise SystemExit("the edge-off trade was not the same leg")
    if hole in [t["entry_ms"] for t in rules] or hole in [t["entry_ms"] for t in nulls]:
        raise SystemExit("a missing close was scored")
    if abs(rules[0]["net"] - float(_long(Decimal(50), Decimal(55)))) > 1e-12:
        raise SystemExit("the edge fill moved")
    if abs(nulls[0]["net"] - float(_long(Decimal(40), Decimal(42)))) > 1e-12:
        raise SystemExit("the edge-off fill moved")
    if [t["entry_ms"] for t in c.rule_trades(book, parts)] != [entry]:
        raise SystemExit("a fair value stamped on the entry was used")
    signal = "usd" if c.FAIR_KIND == "quote" else "us"
    missing = {name: dict(values) for name, values in parts.items()}
    del missing[signal][entry - day]
    missing[signal][entry] = Decimal(10**9)
    if any(t["entry_ms"] == entry for t in c.rule_trades(book, missing)):
        raise SystemExit("a fair value that was not yet published was used")
    wrecked = dict(book)
    wrecked[entry] = (Decimal("500"), Decimal("200"))
    if [t["entry_ms"] for t in c.rule_trades(wrecked, parts)] != [entry]:
        raise SystemExit("the entry open moved the edge")
    used_open = dict(book)
    used_open[entry - day] = (Decimal("1000"), close)
    if [t["entry_ms"] for t in c.rule_trades(used_open, parts)] != [entry]:
        raise SystemExit("the previous open was read as the close")
    thin = dict(book)
    del thin[entry + c.HOLD_DAYS * day]
    if any(t["entry_ms"] == entry for t in c.rule_trades(thin, parts)):
        raise SystemExit("a missing open was borrowed")
    empty = {c.fp5.SCREEN_END_MS: (Decimal("100"), Decimal("100"))}
    if c.rule_trades(empty, parts):
        raise SystemExit("a 2024 open was an entry")
    rich_close = dict(book)
    rich_close[entry - day] = (Decimal("100"), Decimal("200"))
    rich_close[entry] = (Decimal("50"), close)
    if any(t["entry_ms"] == entry for t in c.rule_trades(rich_close, parts)):
        raise SystemExit("the entry day's close was used as the signal")
    wide = dict(book)
    wide[entry - day] = (Decimal("100"), close, Decimal("999"))
    if any(t["entry_ms"] == entry for t in c.rule_trades(wide, parts)):
        raise SystemExit("a high or a low was read")
    if c.FAIR_KIND == "relative":
        early = c.fp5.SCREEN_START_MS + 10 * day
        if early >= c.READY_MS:
            raise SystemExit("the pin is not before publication")
        early_book = dict(book)
        early_book[early - day] = (close, close)
        early_book[early] = (Decimal("50"), Decimal("50"))
        early_book[early + c.HOLD_DAYS * day] = (Decimal("55"), Decimal("55"))
        early_parts = {name: dict(values) for name, values in parts.items()}
        _put(early_parts, early - day, exact)
        entries = [t["entry_ms"] for t in c.rule_trades(early_book, early_parts)]
        null_entries = [t["entry_ms"] for t in c.null_trades(early_book, early_parts)]
        if early in entries or early in null_entries:
            raise SystemExit("a price that was not yet published was a trade")


def main() -> None:
    test_rule()
    print(Path(__file__).resolve().parent.name, "pins ok")


if __name__ == "__main__":
    main()
