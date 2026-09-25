from __future__ import annotations

"""Pins for the fp323 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _long(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def test_rule() -> None:
    if c.IDEA != "WBPAR" or c.HOLD_DAYS != 2 or c.NULL_KIND != "other_regime":
        raise SystemExit("the idea moved")
    if c.MODE != "regime" or c.RULE_SIDE != "long" or c.RULE_BOOK != "spot":
        raise SystemExit("the leg moved")
    if c.FAIR_KIND != "par" or c.COIN != "WBTCBTC" or c.THRESHOLD_BPS != Decimal("1"):
        raise SystemExit("the fair value moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 80 * day
    off = entry + 40 * day
    hole = entry + 60 * day
    book = {}
    # Previous close is the signal. Par is one. The entry open is the fill only.
    book[entry - day] = (Decimal("2"), Decimal("0.9999"))
    book[entry] = (Decimal("50"), Decimal("1.01"))
    book[entry + c.HOLD_DAYS * day] = (Decimal("55"), Decimal("1.01"))
    book[off - day] = (Decimal("2"), Decimal("0.99995"))
    book[off] = (Decimal("40"), Decimal("0.5"))
    book[off + c.HOLD_DAYS * day] = (Decimal("42"), Decimal("0.5"))
    book[hole] = (Decimal("70"), Decimal("0.5"))
    book[hole + c.HOLD_DAYS * day] = (Decimal("71"), Decimal("0.5"))
    # A daily series is not the par. An expensive stamp must not erase the trade.
    fair = {entry - day: Decimal("0.01"), entry: Decimal("0.01")}

    rules = c.rule_trades(book, fair)
    nulls = c.null_trades(book, fair)
    if [t["entry_ms"] for t in rules] != [entry] or rules[0]["book"] != "spot" or rules[0]["side"] != "long":
        raise SystemExit("the price edge was not the traded leg")
    if [t["entry_ms"] for t in nulls] != [off] or nulls[0]["side"] != "long" or nulls[0]["book"] != "spot":
        raise SystemExit("the edge-off trade was not the same leg")
    if hole in [t["entry_ms"] for t in rules] or hole in [t["entry_ms"] for t in nulls]:
        raise SystemExit("a missing close was scored")
    if [t["entry_ms"] for t in c.rule_trades(book, {})] != [entry]:
        raise SystemExit("the standing par was treated as a missing print")
    if abs(rules[0]["net"] - float(_long(Decimal(50), Decimal(55)))) > 1e-12:
        raise SystemExit("the edge fill moved")
    if abs(nulls[0]["net"] - float(_long(Decimal(40), Decimal(42)))) > 1e-12:
        raise SystemExit("the edge-off fill moved")
    wrecked = dict(book)
    wrecked[entry] = (Decimal("500"), Decimal("1.01"))
    if [t["entry_ms"] for t in c.rule_trades(wrecked, fair)] != [entry]:
        raise SystemExit("the entry open moved the edge")
    used_open = dict(book)
    used_open[entry - day] = (Decimal("0.5"), Decimal("0.9999"))
    if [t["entry_ms"] for t in c.rule_trades(used_open, fair)] != [entry]:
        raise SystemExit("the previous open was read as the close")
    thin = dict(book)
    del thin[entry + c.HOLD_DAYS * day]
    if any(t["entry_ms"] == entry for t in c.rule_trades(thin, fair)):
        raise SystemExit("a missing open was borrowed")
    empty = {c.fp5.SCREEN_END_MS: (Decimal("1"), Decimal("0.9"))}
    if c.rule_trades(empty, fair):
        raise SystemExit("a 2024 open was an entry")
    rich_close = dict(book)
    rich_close[entry - day] = (Decimal("0.9"), Decimal("1.01"))
    rich_close[entry] = (Decimal("50"), Decimal("0.9999"))
    if any(t["entry_ms"] == entry for t in c.rule_trades(rich_close, fair)):
        raise SystemExit("the entry day's close was used as the signal")


def main() -> None:
    test_rule()
    print("fp323 pins ok")


if __name__ == "__main__":
    main()
