from __future__ import annotations

"""Pins for the fp245 rule. No file and no return from 2023 is read."""

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


def test_cdec() -> None:
    if c.IDEA != "CDEC" or c.MIN_N != 30 or c.HOLD_DAYS != 15:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    cm, um = {}, {}
    y = entry - day
    _put(cm, y, 1, 80)
    _put(cm, y - 20 * day, 1, 100)
    _put(um, entry, 40, 1)
    _put(um, entry + 15 * day, 30, 1)
    py = missed - day
    _put(cm, py, 1, 120)
    _put(cm, py - 20 * day, 1, 100)
    _put(um, missed, 25, 90)
    _put(um, missed + 15 * day, 25, 1)
    trades = c.signal_trades(cm, um)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the USDT leg was sold without a finished decline")
    want = _short(Decimal(40), Decimal(30))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg short moved")
    pool = {stamp for stamp, _exit in c.pool_spans(cm, um)}
    if entry not in pool or missed not in pool:
        raise SystemExit("the null dropped a fifteen-day short")
    if c.signal_trades({}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_cdec()
    print("fp245 pins ok")


if __name__ == "__main__":
    main()
