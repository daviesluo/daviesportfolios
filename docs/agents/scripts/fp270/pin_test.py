from __future__ import annotations

"""Pins for the fp270 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != "INUP" or c.HOLD_DAYS != 17 or c.NULL_KIND != "other_side":
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 80 * day
    missed = entry + 40 * day
    spot, um, cm = {}, {}, {}
    _put(cm, entry - 21 * day, 1, 100)
    _put(cm, entry - 6 * day, 1, 130)
    _put(cm, entry - day, 1, 120)
    _put(cm, entry, 50, 1)
    _put(cm, entry + 17 * day, 40, 1)
    _put(cm, missed - 21 * day, 1, 100)
    _put(cm, missed - 6 * day, 1, 100)
    _put(cm, missed - day, 1, 110)
    _put(cm, missed, 50, 1)
    _put(cm, missed + 17 * day, 40, 1)
    rules = c.rule_trades(spot, um, cm)
    nulls = c.null_trades(spot, um, cm)
    if len(rules) != 1 or rules[0]["side"] != "short" or rules[0]["entry_ms"] != entry:
        raise SystemExit("the book was not sold")
    if len(nulls) != 1 or nulls[0]["side"] != "long" or nulls[0]["entry_ms"] != entry:
        raise SystemExit("the long was not the other trade")
    if abs(rules[0]["net"] - float(_short(Decimal(50), Decimal(40)))) > 1e-12:
        raise SystemExit("the short moved")
    if abs(nulls[0]["net"] - float(_long(Decimal(50), Decimal(40)))) > 1e-12:
        raise SystemExit("the long moved")
    thin = dict(cm)
    del thin[entry + 17 * day]
    if c.rule_trades(spot, um, thin) or c.null_trades(spot, um, thin):
        raise SystemExit("a missing open was filled in")
    wrecked = dict(cm)
    wrecked[entry] = (500.0, wrecked[entry][1])
    if [t["entry_ms"] for t in c.rule_trades(spot, um, wrecked)] != [entry]:
        raise SystemExit("the entry open moved a sell")
    blind = dict(cm)
    del blind[entry - day]
    if c.rule_trades(spot, um, blind):
        raise SystemExit("a missing close was filled in")
    if c.rule_trades({}, {}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp270 pins ok")


if __name__ == "__main__":
    main()
