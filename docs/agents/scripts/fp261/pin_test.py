from __future__ import annotations

"""Pins for the fp261 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != "LAGB" or c.HOLD_DAYS != 6 or c.RULE_SIDE != "short":
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    spot, um, cm = {}, {}, {}
    _put(cm, entry - day, 1, 90)
    _put(cm, entry - 12 * day, 1, 100)
    _put(spot, entry - day, 1, 95)
    _put(spot, entry - 12 * day, 1, 100)
    _put(um, entry, 40, 1)
    _put(um, entry + 6 * day, 32, 1)
    _put(cm, entry, 50, cm.get(entry, (1, 1))[1])
    _put(cm, entry + 6 * day, 45, 1)
    _put(cm, missed - day, 1, 110)
    _put(cm, missed - 12 * day, 1, 100)
    _put(spot, missed - day, 1, 90)
    _put(spot, missed - 12 * day, 1, 100)
    _put(um, missed, 40, 1)
    _put(um, missed + 6 * day, 32, 1)
    _put(cm, missed, 50, 1)
    _put(cm, missed + 6 * day, 45, 1)
    rules = c.rule_trades(spot, um, cm)
    nulls = c.null_trades(spot, um, cm)
    if len(rules) != 1 or rules[0]["book"] != "um" or rules[0]["side"] != "short":
        raise SystemExit("USDT was sold without the coin-margined book lagging")
    if len(nulls) != 1 or nulls[0]["book"] != "cm" or nulls[0]["side"] != "short":
        raise SystemExit("the coin-margined short was not the other trade")
    if abs(rules[0]["net"] - float(_short(Decimal(40), Decimal(32)))) > 1e-12:
        raise SystemExit("the USDT short moved")
    if abs(nulls[0]["net"] - float(_short(Decimal(50), Decimal(45)))) > 1e-12:
        raise SystemExit("the coin-margined short moved")
    if missed in {t["entry_ms"] for t in rules}:
        raise SystemExit("a leading coin-margined day was sold")
    thin = dict(um)
    del thin[entry + 6 * day]
    if c.rule_trades(spot, thin, cm):
        raise SystemExit("a missing USDT open was filled from the other book")
    wrecked = dict(um)
    wrecked[entry] = (400.0, 1.0)
    if [t["entry_ms"] for t in c.rule_trades(spot, wrecked, cm)] != [entry]:
        raise SystemExit("the entry open moved a sell")
    if c.rule_trades({}, {c.fp5.SCREEN_END_MS: (1.0, 1.0)}, {}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp261 pins ok")


if __name__ == "__main__":
    main()
