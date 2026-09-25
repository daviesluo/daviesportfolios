from __future__ import annotations

"""Pins for the fp234 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _short(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (entry * (1 - fee)) / (exit_px * (1 + fee)) - 1


def _put(book, ts, open_px, close_px):
    book[ts] = (float(open_px), float(close_px))


def test_the_fall_is_already_finished() -> None:
    if c.IDEA != "UMSH" or c.MIN_N != 30 or c.HOLD_DAYS != 11:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    um = {}
    yesterday = entry - day
    _put(um, yesterday, 1, 80)
    _put(um, yesterday - 4 * day, 1, 100)
    _put(um, yesterday - 8 * day, 1, 50)
    _put(um, entry, 40, 10)
    _put(um, entry + 11 * day, 30, 1)
    prior = missed - day
    _put(um, prior, 1, 120)
    _put(um, prior - 4 * day, 1, 100)
    _put(um, prior - 8 * day, 1, 50)
    _put(um, missed, 25, 10)
    _put(um, missed + 11 * day, 25, 1)
    trades = c.signal_trades(um)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the fall was not yesterday's close")
    want = _short(Decimal(40), Decimal(30))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg short moved")
    if abs(trades[0]["gross"] - (40.0 / 30.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the one short")
    pool = {stamp for stamp, _exit in c.pool_spans(um)}
    if entry not in pool or missed not in pool:
        raise SystemExit("the null dropped an eleven-day short")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_the_fall_is_already_finished()
    print("fp234 pins ok")


if __name__ == "__main__":
    main()
