from __future__ import annotations

"""Pins for the fp231 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _net(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def test_the_new_quarterly_is_held_eleven_days() -> None:
    if c.IDEA != "QNEW" or c.MIN_N != 30 or c.HOLD_DAYS != 11 or c.AGE_MAX != 13:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    listed, expiry, symbol = c.LISTED[0]
    later_listed, _later_expiry, later = c.LISTED[1]
    books = {name: {} for _listed, _expiry, name in c.LISTED}
    young = c.fp5.SCREEN_START_MS
    if (young - listed) // day != 2:
        raise SystemExit("January the first is not the second day after listing")
    old = young + 19 * day
    books[symbol][young] = (100.0,)
    books[symbol][young + 11 * day] = (110.0,)
    books[symbol][old] = (40.0,)
    books[symbol][old + 11 * day] = (40.0,)
    books[later][later_listed] = (50.0,)
    books[later][later_listed + 11 * day] = (80.0,)
    books[symbol][later_listed] = (90.0,)
    books[symbol][later_listed + 11 * day] = (90.0,)
    trades = {trade["entry_ms"]: trade for trade in c.signal_trades(books)}
    if young not in trades or later_listed not in trades or old in trades:
        raise SystemExit("the first fortnight moved")
    if trades[young]["exit_ms"] - young != 11 * day:
        raise SystemExit("the hold is not eleven days")
    if trades[young]["exit_ms"] >= expiry:
        raise SystemExit("the sale landed on expiry")
    want = _net(Decimal(100), Decimal(110))
    if abs(trades[young]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg fill moved")
    switched = _net(Decimal(50), Decimal(80))
    if abs(trades[later_listed]["net"] - float(switched)) > 1e-12:
        raise SystemExit("the new listing did not replace the older contract")
    pool = {entry for entry, _exit in c.pool_spans(books)}
    if young not in pool or old not in pool or later_listed not in pool:
        raise SystemExit("the null is not the rest of that contract")
    if len(pool) <= len(trades):
        raise SystemExit("the null is not larger than the rule")
    if c.signal_trades({}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_the_new_quarterly_is_held_eleven_days()
    print("fp231 pins ok")


if __name__ == "__main__":
    main()
