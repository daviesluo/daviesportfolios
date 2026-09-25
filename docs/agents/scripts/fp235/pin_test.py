from __future__ import annotations

"""Pins for the fp235 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _long(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def _put(book, ts, open_px, close_px):
    book[ts] = (float(open_px), float(close_px))


def _rise(book, yesterday, day):
    _put(book, yesterday, 1, 120)
    _put(book, yesterday - 6 * day, 1, 100)


def test_all_three_rises_are_already_finished() -> None:
    if c.IDEA != "TRI" or c.MIN_N != 30 or c.HOLD_DAYS != 7:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    spot, um, cm = {}, {}, {}
    yesterday = entry - day
    for book in (spot, um, cm):
        _rise(book, yesterday, day)
    _put(cm, entry, 50, 1)
    _put(cm, entry + 7 * day, 55, 1)
    prior = missed - day
    _rise(um, prior, day)
    _rise(cm, prior, day)
    _put(spot, prior, 1, 90)
    _put(spot, prior - 6 * day, 1, 100)
    _put(spot, missed, 1, 200)
    _put(cm, missed, 40, 1)
    _put(cm, missed + 7 * day, 40, 1)
    trades = c.signal_trades(spot, um, cm)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("a book that had not risen was bought")
    want = _long(Decimal(50), Decimal(55))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg long moved")
    pool = {stamp for stamp, _exit in c.pool_spans(spot, um, cm)}
    if entry not in pool or missed not in pool:
        raise SystemExit("the null dropped a seven-day long")
    if c.signal_trades({}, {}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_all_three_rises_are_already_finished()
    print("fp235 pins ok")


if __name__ == "__main__":
    main()
