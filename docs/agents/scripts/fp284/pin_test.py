from __future__ import annotations

"""Pins for the fp284 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _long(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def _short(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (entry * (1 - fee)) / (exit_px * (1 + fee)) - 1


def _put(book, ts, open_px, close_px):
    book[ts] = (float(open_px), float(close_px))


def test_rule() -> None:
    if c.IDEA != "TRIO" or c.HOLD_DAYS != 21 or c.NULL_KIND != "other_book":
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 80 * day
    spot, um, cm = {}, {}, {}
    for book, newer in ((spot, 110), (um, 108), (cm, 112)):
        _put(book, entry - 11 * day, 1, 100)
        _put(book, entry - day, 1, newer)
    _put(cm, entry, 50, 1)
    _put(cm, entry + 21 * day, 55, 1)
    _put(spot, entry, 40, 1)
    _put(spot, entry + 21 * day, 44, 1)
    rules = c.rule_trades(spot, um, cm)
    nulls = c.null_trades(spot, um, cm)
    if len(rules) != 1 or rules[0]["book"] != "cm" or rules[0]["side"] != "long":
        raise SystemExit("the coin-margined book was not bought")
    if len(nulls) != 1 or nulls[0]["book"] != "spot" or nulls[0]["entry_ms"] != entry:
        raise SystemExit("spot was not the other trade")
    if abs(rules[0]["net"] - float(_long(Decimal(50), Decimal(55)))) > 1e-12:
        raise SystemExit("the coin-margined long moved")
    if abs(nulls[0]["net"] - float(_long(Decimal(40), Decimal(44)))) > 1e-12:
        raise SystemExit("the spot long moved")
    flat = dict(um)
    flat[entry - day] = (flat[entry - day][0], 100.0)
    if c.rule_trades(spot, flat, cm):
        raise SystemExit("a flat USDT book still bought the coin-margined book")
    thin = dict(spot)
    del thin[entry + 21 * day]
    if c.rule_trades(thin, um, cm):
        raise SystemExit("a missing spot open was filled from the coin-margined book")
    wrecked = dict(cm)
    wrecked[entry] = (500.0, wrecked[entry][1])
    if [t["entry_ms"] for t in c.rule_trades(spot, um, wrecked)] != [entry]:
        raise SystemExit("the entry open moved a buy")
    blind = dict(cm)
    del blind[entry - day]
    if c.rule_trades(spot, um, blind):
        raise SystemExit("a missing close was filled in")
    if c.rule_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}, {}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")

def main() -> None:
    test_rule()
    print("fp284 pins ok")


if __name__ == "__main__":
    main()
