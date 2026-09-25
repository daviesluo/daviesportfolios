from __future__ import annotations

"""Pins for the fp265 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != "LASTUP" or c.HOLD_DAYS != 11 or c.NULL_KIND != "other_side":
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 80 * day
    missed = entry + 40 * day
    spot, um, cm = {}, {}, {}
    _put(spot, entry - day, 1, 90)
    _put(spot, entry - 2 * day, 1, 80)
    _put(spot, entry - 8 * day, 1, 100)
    _put(spot, entry, 40, 1)
    _put(spot, entry + 11 * day, 48, 1)
    _put(spot, missed - day, 1, 110)
    _put(spot, missed - 2 * day, 1, 100)
    _put(spot, missed - 8 * day, 1, 100)
    _put(spot, missed, 40, 1)
    _put(spot, missed + 11 * day, 48, 1)
    rules = c.rule_trades(spot, um, cm)
    nulls = c.null_trades(spot, um, cm)
    if len(rules) != 1 or rules[0]["entry_ms"] != entry or rules[0]["side"] != "long":
        raise SystemExit("spot was bought without the finished decline and up day")
    if len(nulls) != 1 or nulls[0]["side"] != "short" or nulls[0]["book"] != "spot":
        raise SystemExit("the short was not the other trade")
    if abs(rules[0]["net"] - float(_long(Decimal(40), Decimal(48)))) > 1e-12:
        raise SystemExit("the long moved")
    if abs(nulls[0]["net"] - float(_short(Decimal(40), Decimal(48)))) > 1e-12:
        raise SystemExit("the short moved")
    thin = dict(spot)
    del thin[entry + 11 * day]
    if c.rule_trades(thin, um, cm):
        raise SystemExit("a missing spot open was filled in")
    wrecked = dict(spot)
    wrecked[entry] = (400.0, wrecked[entry][1])
    if [t["entry_ms"] for t in c.rule_trades(wrecked, um, cm)] != [entry]:
        raise SystemExit("the entry open moved a buy")
    blind = dict(spot)
    del blind[entry - day]
    if c.rule_trades(blind, um, cm):
        raise SystemExit("a missing close was filled in")
    if c.rule_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}, {}, {}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp265 pins ok")


if __name__ == "__main__":
    main()
