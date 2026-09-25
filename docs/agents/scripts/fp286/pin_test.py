from __future__ import annotations

"""Pins for the fp286 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != "RESUME" or c.HOLD_DAYS != 5 or c.NULL_KIND != "other_time":
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 80 * day
    spot, um, cm = {}, {}, {}
    _put(spot, entry - 16 * day, 1, 100)
    _put(spot, entry - 11 * day, 1, 110)
    _put(spot, entry - 6 * day, 1, 105)
    _put(spot, entry - day, 1, 115)
    _put(spot, entry, 50, 1)
    _put(spot, entry + 5 * day, 55, 1)
    _put(spot, entry + 10 * day, 60, 1)
    rules = c.rule_trades(spot, um, cm)
    nulls = c.null_trades(spot, um, cm)
    if len(rules) != 1 or rules[0]["book"] != "spot" or rules[0]["side"] != "long":
        raise SystemExit("the resumed rise was not bought")
    if len(nulls) != 1 or nulls[0]["entry_ms"] != entry + 5 * day:
        raise SystemExit("the other trade did not start five days later")
    if abs(rules[0]["net"] - float(_long(Decimal(50), Decimal(55)))) > 1e-12:
        raise SystemExit("the long moved")
    if abs(nulls[0]["net"] - float(_long(Decimal(55), Decimal(60)))) > 1e-12:
        raise SystemExit("the later long moved")
    still = dict(spot)
    still[entry - 6 * day] = (still[entry - 6 * day][0], 120.0)
    if c.rule_trades(still, um, cm):
        raise SystemExit("a middle rise was bought")
    thin = dict(spot)
    del thin[entry + 10 * day]
    if c.rule_trades(thin, um, cm):
        raise SystemExit("a missing later open still counted")
    wrecked = dict(spot)
    wrecked[entry] = (500.0, wrecked[entry][1])
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
    print("fp286 pins ok")


if __name__ == "__main__":
    main()
