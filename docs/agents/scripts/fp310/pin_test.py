from __future__ import annotations

"""Pins for the fp310 rule. No file and no return from 2023 is read."""

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
    if c.IDEA != 'KUCCH' or c.HOLD_DAYS != 11 or c.NULL_KIND != "other_regime":
        raise SystemExit("the idea moved")
    if c.MODE != "regime" or c.RULE_SIDE != 'long' or c.RULE_BOOK != 'cm':
        raise SystemExit("the leg moved")
    if c.EDGE != 'cheap' or c.DISCOUNT != 0.0005 or c.WIDEN_LAG != 0:
        raise SystemExit("the edge moved")
    if c.FAIR_KEY != 'kc' or c.FAIR_KEY in ("spot", "um", "cm", "cb", "db"):
        raise SystemExit("the fair value is a Binance line or a reused venue")
    if c.FAIR_SHIFT_MS != 0:
        raise SystemExit("the publication clock moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 80 * day
    off = entry + 40 * day
    spot, um, cm, fair = {}, {}, {}, {}
    books = {"spot": spot, "um": um, "cm": cm}
    traded = books[c.RULE_BOOK]
    shift = c.FAIR_SHIFT_MS

    def fair_open(at: int) -> int:
        return at - 2 * day + shift

    if c.EDGE == "cheap":
        rule_px, rule_fair = 98.0, 100.0
        off_px, off_fair = 100.0, 100.0
    elif c.EDGE == "rich":
        rule_px, rule_fair = 102.0, 100.0
        off_px, off_fair = 100.0, 100.0
    else:
        raise SystemExit("edge")
    _put(traded, entry - day, 1, rule_px)
    _put(fair, fair_open(entry), 1, rule_fair)
    _put(traded, entry, 50, 1)
    _put(traded, entry + c.HOLD_DAYS * day, 55, 1)
    _put(traded, off - day, 1, off_px)
    _put(fair, fair_open(off), 1, off_fair)
    _put(traded, off, 40, 1)
    _put(traded, off + c.HOLD_DAYS * day, 42, 1)
    # A bucket that ends at the entry, or later, is not already published.
    _put(fair, entry - day + shift, 1, 50.0)
    rules = c.rule_trades(spot, um, cm, fair)
    nulls = c.null_trades(spot, um, cm, fair)
    if [t["entry_ms"] for t in rules] != [entry] or rules[0]["book"] != c.RULE_BOOK or rules[0]["side"] != c.RULE_SIDE:
        raise SystemExit("the price edge was not the traded leg")
    if [t["entry_ms"] for t in nulls] != [off] or nulls[0]["side"] != c.RULE_SIDE or nulls[0]["book"] != c.RULE_BOOK:
        raise SystemExit("the edge-off trade was not the same leg")
    expect = _long if c.RULE_SIDE == "long" else _short
    if abs(rules[0]["net"] - float(expect(Decimal(50), Decimal(55)))) > 1e-12:
        raise SystemExit("the edge fill moved")
    if abs(nulls[0]["net"] - float(expect(Decimal(40), Decimal(42)))) > 1e-12:
        raise SystemExit("the edge-off fill moved")
    late = dict(fair)
    del late[fair_open(entry)]
    if any(t["entry_ms"] == entry for t in c.rule_trades(spot, um, cm, late)):
        raise SystemExit("a fair value that was not yet published was used")
    wrecked = dict(traded)
    wrecked[entry] = (500.0, wrecked[entry][1])
    books[c.RULE_BOOK] = wrecked
    if [t["entry_ms"] for t in c.rule_trades(books["spot"], books["um"], books["cm"], fair)] != [entry]:
        raise SystemExit("the entry open moved the edge")
    books[c.RULE_BOOK] = traded
    fair_open_wrecked = dict(fair)
    row = fair_open_wrecked[fair_open(entry)]
    fair_open_wrecked[fair_open(entry)] = (row[0] * 10.0, row[1])
    if [t["entry_ms"] for t in c.rule_trades(spot, um, cm, fair_open_wrecked)] != [entry]:
        raise SystemExit("the fair-value open moved the edge")
    thin = dict(traded)
    del thin[entry + c.HOLD_DAYS * day]
    books[c.RULE_BOOK] = thin
    if any(t["entry_ms"] == entry for t in c.rule_trades(books["spot"], books["um"], books["cm"], fair)):
        raise SystemExit("a missing open was borrowed")
    empty = {"spot": {}, "um": {}, "cm": {}}
    empty[c.RULE_BOOK][c.fp5.SCREEN_END_MS] = (100.0, 100.0)
    if c.rule_trades(empty["spot"], empty["um"], empty["cm"], {}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_rule()
    print("fp310 pins ok")


if __name__ == "__main__":
    main()
