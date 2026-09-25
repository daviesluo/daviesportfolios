from __future__ import annotations

"""Pins for the fp226 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _net(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def _put(book, ts, open_px, close_px):
    book[ts] = (float(open_px), float(close_px))


def test_the_pullback_uses_yesterday_and_holds_ten_days() -> None:
    if c.IDEA != "PBK" or c.MIN_N != 30 or c.HOLD_DAYS != 10 or c.SLOW != 20 or c.FAST != 5:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    flat = entry + 160 * day
    spot = {}
    yesterday = entry - day
    _put(spot, yesterday - 20 * day, 1, 80)
    _put(spot, yesterday - 5 * day, 1, 100)
    _put(spot, yesterday, 1, 90)
    _put(spot, entry, 100, 1)
    _put(spot, entry + 10 * day, 130, 1)
    prior = missed - day
    _put(spot, prior - 20 * day, 1, 80)
    _put(spot, prior - 5 * day, 1, 300)
    _put(spot, prior, 1, 50)
    _put(spot, missed, 10, 200)
    _put(spot, missed + 10 * day, 10, 1)
    ago = flat - day
    _put(spot, ago - 20 * day, 1, 40)
    _put(spot, ago - 5 * day, 1, 40)
    _put(spot, ago, 1, 40)
    _put(spot, flat, 10, 10)
    _put(spot, flat + 10 * day, 10, 10)
    trades = c.signal_trades(spot)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the pullback was not yesterday's closes")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] != 10 * day:
        raise SystemExit("the hold is not ten days")
    want = _net(Decimal(100), Decimal(130))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg fill moved")
    if abs(trades[0]["gross"] - (130.0 / 100.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the one leg")
    pool = {stamp for stamp, _exit in c.pool_spans(spot)}
    if entry not in pool or missed not in pool or flat not in pool:
        raise SystemExit("the null dropped a ten-day spot long")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_the_pullback_uses_yesterday_and_holds_ten_days()
    print("fp226 pins ok")


if __name__ == "__main__":
    main()
