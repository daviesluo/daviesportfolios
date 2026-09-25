from __future__ import annotations

"""Pins for the fp272 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != "LEDSP" or c.HOLD_DAYS != 24 or c.NULL_KIND != "other_book":
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 80 * day
    missed = entry + 40 * day
    spot, um, cm = {}, {}, {}
    _put(spot, entry - day, 1, 110)
    _put(spot, entry - 11 * day, 1, 100)
    _put(um, entry - day, 1, 100)
    _put(um, entry - 11 * day, 1, 100)
    _put(cm, entry, 30, 1)
    _put(cm, entry + 24 * day, 27, 1)
    _put(um, entry, 40, 1)
    _put(um, entry + 24 * day, 36, 1)
    _put(spot, missed - day, 1, 90)
    _put(spot, missed - 11 * day, 1, 100)
    _put(um, missed - day, 1, 100)
    _put(um, missed - 11 * day, 1, 100)
    _put(cm, missed, 30, 1)
    _put(cm, missed + 24 * day, 27, 1)
    _put(um, missed, 40, 1)
    _put(um, missed + 24 * day, 36, 1)
    rules = c.rule_trades(spot, um, cm)
    nulls = c.null_trades(spot, um, cm)
    if len(rules) != 1 or rules[0]["book"] != "cm" or rules[0]["side"] != "short":
        raise SystemExit("the coin-margined book was not sold")
    if len(nulls) != 1 or nulls[0]["book"] != "um" or nulls[0]["side"] != "short":
        raise SystemExit("the USDT short was not the other trade")
    if abs(rules[0]["net"] - float(_short(Decimal(30), Decimal(27)))) > 1e-12:
        raise SystemExit("the coin-margined short moved")
    if abs(nulls[0]["net"] - float(_short(Decimal(40), Decimal(36)))) > 1e-12:
        raise SystemExit("the USDT short moved")
    thin = dict(cm)
    del thin[entry + 24 * day]
    if c.rule_trades(spot, um, thin):
        raise SystemExit("a missing coin-margined open was filled from the USDT book")
    wrecked = dict(cm)
    wrecked[entry] = (300.0, wrecked[entry][1])
    if [t["entry_ms"] for t in c.rule_trades(spot, um, wrecked)] != [entry]:
        raise SystemExit("the entry open moved a sell")
    blind = dict(spot)
    del blind[entry - day]
    if c.rule_trades(blind, um, cm):
        raise SystemExit("a missing close was filled in")
    if c.rule_trades({}, {}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp272 pins ok")


if __name__ == "__main__":
    main()
