from __future__ import annotations

"""Pins for the fp274 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != "ABOVE" or c.HOLD_DAYS != 18 or c.NULL_KIND != "other_book":
        raise SystemExit("the idea moved")

    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 80 * day
    spot, um, cm = {}, {}, {}
    _put(um, entry - day, 1, 110)
    _put(spot, entry - day, 1, 100)
    _put(um, entry, 40, 1)
    _put(um, entry + 18 * day, 36, 1)
    _put(spot, entry, 50, 1)
    _put(spot, entry + 18 * day, 48, 1)
    rules = c.rule_trades(spot, um, cm)
    nulls = c.null_trades(spot, um, cm)
    if len(rules) != 1 or rules[0]["book"] != "um" or rules[0]["side"] != "short":
        raise SystemExit("the richer USDT close was not sold")
    if len(nulls) != 1 or nulls[0]["book"] != "spot" or nulls[0]["entry_ms"] != entry:
        raise SystemExit("spot was not the other trade")
    if abs(rules[0]["net"] - float(_short(Decimal(40), Decimal(36)))) > 1e-12:
        raise SystemExit("the USDT short moved")
    if abs(nulls[0]["net"] - float(_short(Decimal(50), Decimal(48)))) > 1e-12:
        raise SystemExit("the spot short moved")
    thin = dict(um)
    del thin[entry + 18 * day]
    if c.rule_trades(spot, thin, cm):
        raise SystemExit("a missing USDT open was filled from spot")
    wrecked = dict(um)
    wrecked[entry] = (400.0, wrecked[entry][1])
    if [t["entry_ms"] for t in c.rule_trades(spot, wrecked, cm)] != [entry]:
        raise SystemExit("the entry open moved a sell")
    blind = dict(um)
    del blind[entry - day]
    if c.rule_trades(spot, blind, cm):
        raise SystemExit("a missing close was filled in")
    if c.rule_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}, {c.fp5.SCREEN_END_MS: (110.0, 110.0)}, {}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp274 pins ok")


if __name__ == "__main__":
    main()
