from __future__ import annotations

"""Pins for the fp263 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != "LATER" or c.HOLD_DAYS != 15 or c.NULL_KIND != "other_time":
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 90 * day
    spot = {}
    _put(spot, entry - day, 1, 110)
    _put(spot, entry - 3 * day, 1, 100)
    _put(spot, entry - 5 * day, 1, 120)
    _put(spot, entry, 40, 1)
    _put(spot, entry + 15 * day, 48, 1)
    _put(spot, entry + 30 * day, 50, 1)
    _put(spot, missed - day, 1, 110)
    _put(spot, missed - 3 * day, 1, 100)
    _put(spot, missed - 5 * day, 1, 80)
    _put(spot, missed, 40, 1)
    _put(spot, missed + 15 * day, 48, 1)
    _put(spot, missed + 30 * day, 50, 1)
    rules = c.rule_trades(spot, {}, {})
    nulls = c.null_trades(spot, {}, {})
    if len(rules) != 1 or rules[0]["entry_ms"] != entry or rules[0]["side"] != "long":
        raise SystemExit("spot was bought without a new two-day rise")
    if len(nulls) != 1 or nulls[0]["entry_ms"] != entry + 15 * day:
        raise SystemExit("the later long was not the other trade")
    if abs(rules[0]["net"] - float(_long(Decimal(40), Decimal(48)))) > 1e-12:
        raise SystemExit("the long moved")
    if abs(nulls[0]["net"] - float(_long(Decimal(48), Decimal(50)))) > 1e-12:
        raise SystemExit("the later long moved")
    if missed in {t["entry_ms"] for t in rules} or missed in {t["entry_ms"] for t in nulls}:
        raise SystemExit("a rise that was already rising was bought")
    late = dict(spot)
    del late[entry + 30 * day]
    if c.rule_trades(late, {}, {}):
        raise SystemExit("the later window was not required")
    wrecked = dict(spot)
    wrecked[entry] = (400.0, wrecked[entry][1])
    if [t["entry_ms"] for t in c.rule_trades(wrecked, {}, {})] != [entry]:
        raise SystemExit("the entry open moved a buy")
    if c.rule_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}, {}, {}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp263 pins ok")


if __name__ == "__main__":
    main()
