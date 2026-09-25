from __future__ import annotations

"""Pins for the fp241 rule. No file and no return from 2023 is read."""

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


def test_drop() -> None:
    if c.IDEA != "DROP" or c.MIN_N != 30 or c.HOLD_DAYS != 16:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    spot, cm = {}, {}
    y = entry - day
    _put(spot, y, 1, 90)
    _put(spot, y - 3 * day, 1, 100)
    _put(cm, entry, 30, 200)
    _put(cm, entry + 16 * day, 40, 1)
    py = missed - day
    _put(spot, py, 1, 110)
    _put(spot, py - 3 * day, 1, 100)
    _put(cm, missed, 25, 90)
    _put(cm, missed + 16 * day, 25, 1)
    trades = c.signal_trades(spot, cm)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the coin-margined leg was bought without a finished decline")
    want = _long(Decimal(30), Decimal(40))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg long moved")
    pool = {stamp for stamp, _exit in c.pool_spans(spot, cm)}
    if entry not in pool or missed not in pool:
        raise SystemExit("the null dropped a sixteen-day long")
    if c.signal_trades({}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_drop()
    print("fp241 pins ok")


if __name__ == "__main__":
    main()
