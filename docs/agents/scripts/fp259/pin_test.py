from __future__ import annotations

"""Pins for the fp259 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != "DEFER" or c.HOLD_DAYS != 10 or c.NULL_KIND != "other_time":
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    spot = {}
    _put(spot, entry - day, 1, 90)
    _put(spot, entry - 7 * day, 1, 100)
    _put(spot, entry, 40, 1)
    _put(spot, entry + 10 * day, 32, 1)
    _put(spot, entry + 20 * day, 30, 1)
    _put(spot, missed - day, 1, 110)
    _put(spot, missed - 7 * day, 1, 100)
    _put(spot, missed, 40, 1)
    _put(spot, missed + 10 * day, 32, 1)
    _put(spot, missed + 20 * day, 30, 1)
    rules = c.rule_trades(spot, {}, {})
    nulls = c.null_trades(spot, {}, {})
    if len(rules) != 1 or rules[0]["entry_ms"] != entry or rules[0]["side"] != "short":
        raise SystemExit("spot was sold without a finished decline")
    if len(nulls) != 1 or nulls[0]["entry_ms"] != entry + 10 * day:
        raise SystemExit("the later short was not the other trade")
    if nulls[0]["exit_ms"] - nulls[0]["entry_ms"] != 10 * day:
        raise SystemExit("the null hold moved")
    if abs(rules[0]["net"] - float(_short(Decimal(40), Decimal(32)))) > 1e-12:
        raise SystemExit("the short moved")
    if abs(nulls[0]["net"] - float(_short(Decimal(32), Decimal(30)))) > 1e-12:
        raise SystemExit("the later short moved")
    if missed in {t["entry_ms"] for t in rules} or missed in {t["entry_ms"] for t in nulls}:
        raise SystemExit("a rise was traded")
    late = dict(spot)
    del late[entry + 20 * day]
    if c.rule_trades(late, {}, {}):
        raise SystemExit("the later window was not required")
    wrecked = dict(spot)
    wrecked[entry] = (400.0, wrecked[entry][1])
    if [t["entry_ms"] for t in c.rule_trades(wrecked, {}, {})] != [entry]:
        raise SystemExit("the entry open moved a sell")
    if c.rule_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}, {}, {}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp259 pins ok")


if __name__ == "__main__":
    main()
