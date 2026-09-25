from __future__ import annotations

"""Pins for the fp262 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != "OTHER" or c.HOLD_DAYS != 10 or c.NULL_KIND != "other_regime":
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    equal = entry + 50 * day
    spot, cm = {}, {}
    _put(spot, entry - day, 1, 102)
    _put(spot, entry - 6 * day, 1, 100)
    _put(spot, entry - 16 * day, 1, 150)
    _put(cm, entry, 30, 1)
    _put(cm, entry + 10 * day, 33, 1)
    _put(spot, missed - day, 1, 80)
    _put(spot, missed - 6 * day, 1, 100)
    _put(spot, missed - 16 * day, 1, 84)
    _put(cm, missed, 40, 1)
    _put(cm, missed + 10 * day, 44, 1)
    _put(spot, equal - day, 1, 110)
    _put(spot, equal - 6 * day, 1, 100)
    _put(spot, equal - 16 * day, 1, 100)
    _put(cm, equal, 20, 1)
    _put(cm, equal + 10 * day, 22, 1)
    rules = c.rule_trades(spot, {}, cm)
    nulls = c.null_trades(spot, {}, cm)
    if [t["entry_ms"] for t in rules] != [missed]:
        raise SystemExit("the larger day was not the rule")
    if [t["entry_ms"] for t in nulls] != [entry]:
        raise SystemExit("the quieter day was not the other trade")
    if equal in {t["entry_ms"] for t in rules} or equal in {t["entry_ms"] for t in nulls}:
        raise SystemExit("an equal day was traded")
    if abs(rules[0]["net"] - float(_long(Decimal(40), Decimal(44)))) > 1e-12:
        raise SystemExit("the larger long moved")
    if abs(nulls[0]["net"] - float(_long(Decimal(30), Decimal(33)))) > 1e-12:
        raise SystemExit("the other long moved")
    thin = dict(cm)
    del thin[missed + 10 * day]
    left = c.rule_trades(spot, {}, thin)
    right = c.null_trades(spot, {}, thin)
    if left or [t["entry_ms"] for t in right] != [entry]:
        raise SystemExit("a missing open was filled, or the other regime was dropped")
    wrecked = dict(cm)
    wrecked[missed] = (300.0, wrecked[missed][1])
    if [t["entry_ms"] for t in c.rule_trades(spot, {}, wrecked)] != [missed]:
        raise SystemExit("the entry open moved a buy")
    if c.rule_trades({c.fp5.SCREEN_END_MS: (1.0, 1.0)}, {}, {}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp262 pins ok")


if __name__ == "__main__":
    main()
