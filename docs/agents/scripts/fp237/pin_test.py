from __future__ import annotations

"""Pins for the fp237 rule. No file and no return from 2023 is read."""

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


def test_both_rises_are_already_finished() -> None:
    if c.IDEA != "STEP" or c.MIN_N != 30 or c.HOLD_DAYS != 4:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    um = {}
    yesterday = entry - day
    _put(um, yesterday, 1, 110)
    _put(um, yesterday - 3 * day, 1, 100)
    _put(um, yesterday - 6 * day, 1, 90)
    _put(um, entry, 30, 1)
    _put(um, entry + 4 * day, 40, 1)
    prior = missed - day
    _put(um, prior, 1, 90)
    _put(um, prior - 3 * day, 1, 100)
    _put(um, prior - 6 * day, 1, 80)
    _put(um, missed, 25, 120)
    _put(um, missed + 4 * day, 25, 1)
    trades = c.signal_trades(um)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the second rise was not yesterday's close")
    want = _long(Decimal(30), Decimal(40))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg long moved")
    pool = {stamp for stamp, _exit in c.pool_spans(um)}
    if entry not in pool or missed not in pool:
        raise SystemExit("the null dropped a four-day long")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_both_rises_are_already_finished()
    print("fp237 pins ok")


if __name__ == "__main__":
    main()
