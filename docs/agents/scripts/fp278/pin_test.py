from __future__ import annotations

"""Pins for the fp278 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != "BOTHDOWN" or c.HOLD_DAYS != 28 or c.NULL_KIND != "other_book":
        raise SystemExit("the idea moved")

    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 80 * day
    spot, um, cm = {}, {}, {}
    _put(spot, entry - day, 1, 90)
    _put(spot, entry - 10 * day, 1, 100)
    _put(um, entry - day, 1, 80)
    _put(um, entry - 10 * day, 1, 100)
    _put(um, entry, 40, 1)
    _put(um, entry + 28 * day, 36, 1)
    _put(cm, entry, 30, 1)
    _put(cm, entry + 28 * day, 28, 1)
    rules = c.rule_trades(spot, um, cm)
    nulls = c.null_trades(spot, um, cm)
    if len(rules) != 1 or rules[0]["book"] != "um" or rules[0]["side"] != "short":
        raise SystemExit("the USDT book was not sold")
    if len(nulls) != 1 or nulls[0]["book"] != "cm" or nulls[0]["entry_ms"] != entry:
        raise SystemExit("the coin-margined book was not the other trade")
    if abs(rules[0]["net"] - float(_short(Decimal(40), Decimal(36)))) > 1e-12:
        raise SystemExit("the USDT short moved")
    if abs(nulls[0]["net"] - float(_short(Decimal(30), Decimal(28)))) > 1e-12:
        raise SystemExit("the coin-margined short moved")
    thin = dict(um)
    del thin[entry + 28 * day]
    if c.rule_trades(spot, thin, cm):
        raise SystemExit("a missing USDT open was filled from the other book")
    wrecked = dict(um)
    wrecked[entry] = (400.0, wrecked[entry][1])
    if [t["entry_ms"] for t in c.rule_trades(spot, wrecked, cm)] != [entry]:
        raise SystemExit("the entry open moved a sell")
    blind = dict(um)
    del blind[entry - day]
    if c.rule_trades(spot, blind, cm):
        raise SystemExit("a missing close was filled in")
    if c.rule_trades({}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp278 pins ok")


if __name__ == "__main__":
    main()
