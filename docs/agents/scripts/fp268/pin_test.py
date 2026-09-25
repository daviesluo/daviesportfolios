from __future__ import annotations

"""Pins for the fp268 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != "LOUDER" or c.HOLD_DAYS != 21 or c.NULL_KIND != "other_regime":
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 80 * day
    missed = entry + 50 * day
    spot, um, cm = {}, {}, {}
    _put(spot, entry - 7 * day, 1, 100)
    _put(spot, entry - 4 * day, 1, 100)
    _put(spot, entry - day, 1, 80)
    _put(um, entry, 30, 1)
    _put(um, entry + 21 * day, 36, 1)
    _put(spot, missed - 7 * day, 1, 100)
    _put(spot, missed - 4 * day, 1, 80)
    _put(spot, missed - day, 1, 80)
    _put(um, missed, 30, 1)
    _put(um, missed + 21 * day, 33, 1)
    rules = c.rule_trades(spot, um, cm)
    nulls = c.null_trades(spot, um, cm)
    if [t["entry_ms"] for t in rules] != [entry]:
        raise SystemExit("the louder day was not the rule")
    if [t["entry_ms"] for t in nulls] != [missed]:
        raise SystemExit("the quieter day was not the other trade")
    if set(t["entry_ms"] for t in rules) & set(t["entry_ms"] for t in nulls):
        raise SystemExit("a day is in both trades")
    if abs(rules[0]["net"] - float(_long(Decimal(30), Decimal(36)))) > 1e-12:
        raise SystemExit("the long moved")
    thin = dict(um)
    del thin[entry + 21 * day]
    if c.rule_trades(spot, thin, cm):
        raise SystemExit("a missing USDT open was filled in")
    if [t["entry_ms"] for t in c.null_trades(spot, thin, cm)] != [missed]:
        raise SystemExit("the other trade used the rule's missing open")
    wrecked = dict(um)
    wrecked[entry] = (300.0, wrecked[entry][1])
    if [t["entry_ms"] for t in c.rule_trades(spot, wrecked, cm)] != [entry]:
        raise SystemExit("the entry open moved a buy")
    blind = dict(spot)
    del blind[entry - day]
    if c.rule_trades(blind, um, cm):
        raise SystemExit("a missing close was filled in")
    if c.rule_trades({}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}, {}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp268 pins ok")


if __name__ == "__main__":
    main()
