from __future__ import annotations

"""Pins for the fp258 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != "FADEU" or c.HOLD_DAYS != 13 or c.NULL_KIND != "other_side":
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    um = {}
    _put(um, entry - day, 1, 110)
    _put(um, entry - 13 * day, 1, 100)
    _put(um, entry, 40, 1)
    _put(um, entry + 13 * day, 50, 1)
    _put(um, missed - day, 1, 90)
    _put(um, missed - 13 * day, 1, 100)
    _put(um, missed, 40, 1)
    _put(um, missed + 13 * day, 50, 1)
    rules = c.rule_trades({}, um, {})
    nulls = c.null_trades({}, um, {})
    if len(rules) != 1 or rules[0]["side"] != "short" or rules[0]["book"] != "um":
        raise SystemExit("USDT was sold without a finished rise")
    if len(nulls) != 1 or nulls[0]["side"] != "long" or nulls[0]["entry_ms"] != entry:
        raise SystemExit("the long was not the other trade")
    if missed in {t["entry_ms"] for t in rules}:
        raise SystemExit("a decline was traded")
    if abs(rules[0]["net"] - float(_short(Decimal(40), Decimal(50)))) > 1e-12:
        raise SystemExit("the short moved")
    if abs(nulls[0]["net"] - float(_long(Decimal(40), Decimal(50)))) > 1e-12:
        raise SystemExit("the long moved")
    if rules[0]["exit_ms"] - entry != 13 * day or nulls[0]["exit_ms"] - entry != 13 * day:
        raise SystemExit("the hold moved")
    thin = dict(um)
    del thin[entry + 13 * day]
    if c.rule_trades({}, thin, {}) or c.null_trades({}, thin, {}):
        raise SystemExit("a missing open was filled")
    wrecked = dict(um)
    wrecked[entry] = (400.0, wrecked[entry][1])
    if [t["entry_ms"] for t in c.rule_trades({}, wrecked, {})] != [entry]:
        raise SystemExit("the entry open moved a sell")
    if c.rule_trades({}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}, {}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp258 pins ok")


if __name__ == "__main__":
    main()
