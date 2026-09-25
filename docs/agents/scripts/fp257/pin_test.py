from __future__ import annotations

"""Pins for the fp257 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != "PICK" or c.HOLD_DAYS != 9 or c.NULL_KIND != "other_book":
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    spot, um, cm = {}, {}, {}
    _put(spot, entry - day, 1, 90)
    _put(spot, entry - 5 * day, 1, 100)
    _put(spot, entry, 40, 1)
    _put(spot, entry + 9 * day, 48, 1)
    _put(cm, entry, 30, 1)
    _put(cm, entry + 9 * day, 36, 1)
    _put(spot, missed - day, 1, 110)
    _put(spot, missed - 5 * day, 1, 100)
    _put(spot, missed, 40, 1)
    _put(spot, missed + 9 * day, 48, 1)
    _put(cm, missed, 30, 1)
    _put(cm, missed + 9 * day, 36, 1)
    rules = c.rule_trades(spot, um, cm)
    nulls = c.null_trades(spot, um, cm)
    if len(rules) != 1 or rules[0]["entry_ms"] != entry or rules[0]["book"] != "cm":
        raise SystemExit("the coin-margined book was bought without a finished decline")
    if len(nulls) != 1 or nulls[0]["book"] != "spot" or nulls[0]["side"] != "long":
        raise SystemExit("the spot long was not the other trade")
    if abs(rules[0]["net"] - float(_long(Decimal(30), Decimal(36)))) > 1e-12:
        raise SystemExit("the coin-margined long moved")
    if abs(nulls[0]["net"] - float(_long(Decimal(40), Decimal(48)))) > 1e-12:
        raise SystemExit("the spot long moved")
    if rules[0]["exit_ms"] - entry != 9 * day or nulls[0]["exit_ms"] - entry != 9 * day:
        raise SystemExit("the hold moved")
    thin = dict(cm)
    del thin[entry + 9 * day]
    if c.rule_trades(spot, um, thin) or c.null_trades(spot, um, thin):
        raise SystemExit("a missing coin-margined open was filled from spot")
    wrecked = dict(cm)
    wrecked[entry] = (300.0, wrecked[entry][1])
    if [t["entry_ms"] for t in c.rule_trades(spot, um, wrecked)] != [entry]:
        raise SystemExit("the entry open moved a buy")
    blind = dict(spot)
    del blind[entry - day]
    if c.rule_trades(blind, um, cm):
        raise SystemExit("a missing close was filled in")
    if c.rule_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}, {}, {}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp257 pins ok")


if __name__ == "__main__":
    main()
