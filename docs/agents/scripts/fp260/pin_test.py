from __future__ import annotations

"""Pins for the fp260 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != "CMLAG" or c.HOLD_DAYS != 16 or c.NULL_KIND != "other_book":
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    spot, um, cm = {}, {}, {}
    _put(spot, entry - day, 1, 130)
    _put(spot, entry - 9 * day, 1, 100)
    _put(cm, entry - day, 1, 110)
    _put(cm, entry - 9 * day, 1, 100)
    _put(um, entry, 50, 1)
    _put(um, entry + 16 * day, 60, 1)
    _put(cm, entry, 40, 1)
    _put(cm, entry + 16 * day, 44, 1)
    _put(spot, missed - day, 1, 110)
    _put(spot, missed - 9 * day, 1, 100)
    _put(cm, missed - day, 1, 130)
    _put(cm, missed - 9 * day, 1, 100)
    _put(um, missed, 50, 1)
    _put(um, missed + 16 * day, 60, 1)
    _put(cm, missed, 40, 1)
    _put(cm, missed + 16 * day, 44, 1)
    rules = c.rule_trades(spot, um, cm)
    nulls = c.null_trades(spot, um, cm)
    if len(rules) != 1 or rules[0]["book"] != "um" or rules[0]["entry_ms"] != entry:
        raise SystemExit("USDT was bought without spot ahead")
    if len(nulls) != 1 or nulls[0]["book"] != "cm":
        raise SystemExit("the coin-margined long was not the other trade")
    if abs(rules[0]["net"] - float(_long(Decimal(50), Decimal(60)))) > 1e-12:
        raise SystemExit("the USDT long moved")
    if abs(nulls[0]["net"] - float(_long(Decimal(40), Decimal(44)))) > 1e-12:
        raise SystemExit("the coin-margined long moved")
    if missed in {t["entry_ms"] for t in rules}:
        raise SystemExit("a lagging spot day was bought")
    thin = dict(cm)
    del thin[entry + 16 * day]
    if c.rule_trades(spot, um, thin):
        raise SystemExit("a missing coin-margined open was filled from USDT")
    wrecked = dict(um)
    wrecked[entry] = (500.0, wrecked[entry][1])
    if [t["entry_ms"] for t in c.rule_trades(spot, wrecked, cm)] != [entry]:
        raise SystemExit("the entry open moved a buy")
    if c.rule_trades({}, {c.fp5.SCREEN_END_MS: (1.0, 1.0)}, {}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp260 pins ok")


if __name__ == "__main__":
    main()
