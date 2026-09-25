from __future__ import annotations

"""Pins for the fp238 rule. No file and no return from 2023 is read."""

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


def test_the_gap_is_already_printed() -> None:
    if c.IDEA != "GAP" or c.MIN_N != 30 or c.HOLD_DAYS != 6:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    um = {}
    _put(um, entry - day, 50, 1)
    _put(um, entry - 2 * day, 1, 40)
    _put(um, entry, 10, 1)
    _put(um, entry + 6 * day, 20, 1)
    _put(um, missed - day, 30, 1)
    _put(um, missed - 2 * day, 1, 40)
    _put(um, missed, 80, 1)
    _put(um, missed + 6 * day, 80, 1)
    trades = c.signal_trades(um)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the gap was not yesterday's open")
    want = _long(Decimal(10), Decimal(20))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg long moved")
    pool = {stamp for stamp, _exit in c.pool_spans(um)}
    if entry not in pool or missed not in pool:
        raise SystemExit("the null dropped a six-day long")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_the_gap_is_already_printed()
    print("fp238 pins ok")


if __name__ == "__main__":
    main()
