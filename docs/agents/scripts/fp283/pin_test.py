from __future__ import annotations

"""Pins for the fp283 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != "DROPCM" or c.HOLD_DAYS != 11 or c.NULL_KIND != "other_time":
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 80 * day
    spot, um, cm = {}, {}, {}
    _put(cm, entry - 17 * day, 1, 100)
    _put(cm, entry - 9 * day, 1, 120)
    _put(cm, entry - day, 1, 110)
    _put(cm, entry, 50, 1)
    _put(cm, entry + 11 * day, 45, 1)
    _put(cm, entry + 22 * day, 40, 1)
    rules = c.rule_trades(spot, um, cm)
    nulls = c.null_trades(spot, um, cm)
    if len(rules) != 1 or rules[0]["book"] != "cm" or rules[0]["side"] != "short":
        raise SystemExit("the turn down was not sold")
    if len(nulls) != 1 or nulls[0]["entry_ms"] != entry + 11 * day or nulls[0]["side"] != "short":
        raise SystemExit("the other trade did not start eleven days later")
    if abs(rules[0]["net"] - float(_short(Decimal(50), Decimal(45)))) > 1e-12:
        raise SystemExit("the short moved")
    if abs(nulls[0]["net"] - float(_short(Decimal(45), Decimal(40)))) > 1e-12:
        raise SystemExit("the later short moved")
    up = dict(cm)
    up[entry - day] = (up[entry - day][0], 130.0)
    if c.rule_trades(spot, um, up):
        raise SystemExit("a rising eight-day return was sold")
    thin = dict(cm)
    del thin[entry + 22 * day]
    if c.rule_trades(spot, um, thin):
        raise SystemExit("a missing later open still counted")
    wrecked = dict(cm)
    wrecked[entry] = (500.0, wrecked[entry][1])
    if [t["entry_ms"] for t in c.rule_trades(spot, um, wrecked)] != [entry]:
        raise SystemExit("the entry open moved a sale")
    blind = dict(cm)
    del blind[entry - day]
    if c.rule_trades(spot, um, blind):
        raise SystemExit("a missing close was filled in")
    if c.rule_trades({}, {}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")

def main() -> None:
    test_rule()
    print("fp283 pins ok")


if __name__ == "__main__":
    main()
