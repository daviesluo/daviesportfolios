from __future__ import annotations

"""Pins for the fp227 rule. No file and no return from 2023 is read."""

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


def test_the_rise_is_already_finished() -> None:
    if c.IDEA != "CFD" or c.MIN_N != 30 or c.HOLD_DAYS != 8 or c.LOOKBACK != 15:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    cm = {}
    yesterday = entry - day
    _put(cm, yesterday - 15 * day, 1, 80)
    _put(cm, yesterday, 1, 100)
    _put(cm, entry, 50, 10)
    _put(cm, entry + 8 * day, 40, 1)
    prior = missed - day
    _put(cm, prior - 15 * day, 1, 100)
    _put(cm, prior, 1, 90)
    _put(cm, missed, 20, 200)
    _put(cm, missed + 8 * day, 20, 1)
    trades = c.signal_trades(cm)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the rise was not yesterday's close")
    if trades[0]["exit_ms"] - trades[0]["entry_ms"] != 8 * day:
        raise SystemExit("the hold is not eight days")
    want = _short(Decimal(50), Decimal(40))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg short moved")
    if abs(trades[0]["gross"] - (50.0 / 40.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the one short")
    pool = {stamp for stamp, _exit in c.pool_spans(cm)}
    if entry not in pool or missed not in pool:
        raise SystemExit("the null dropped an eight-day short")
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_the_rise_is_already_finished()
    print("fp227 pins ok")


if __name__ == "__main__":
    main()
