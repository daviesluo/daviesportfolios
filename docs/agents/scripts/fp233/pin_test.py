from __future__ import annotations

"""Pins for the fp233 rule. No file and no return from 2023 is read."""

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


def test_the_close_is_already_above_the_prior_ten() -> None:
    if c.IDEA != "HI10" or c.MIN_N != 30 or c.HOLD_DAYS != 8:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    spot = {}
    yesterday = entry - day
    _put(spot, yesterday, 1, 20)
    for k in range(1, 11):
        _put(spot, yesterday - k * day, 1, 10)
    _put(spot, entry, 50, 1)
    _put(spot, entry + 8 * day, 60, 1)
    prior = missed - day
    _put(spot, prior, 1, 15)
    for k in range(1, 11):
        _put(spot, prior - k * day, 1, 30)
    _put(spot, missed, 10, 100)
    _put(spot, missed + 8 * day, 10, 1)
    trades = c.signal_trades(spot)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the high was not yesterday's close")
    want = _long(Decimal(50), Decimal(60))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg long moved")
    pool = {stamp for stamp, _exit in c.pool_spans(spot)}
    if entry not in pool or missed not in pool:
        raise SystemExit("the null dropped an eight-day long")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_the_close_is_already_above_the_prior_ten()
    print("fp233 pins ok")


if __name__ == "__main__":
    main()
