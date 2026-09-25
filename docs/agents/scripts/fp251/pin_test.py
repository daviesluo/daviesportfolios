from __future__ import annotations

"""Pins for the fp251 rule. No file and no return from 2023 is read."""

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



def test_lagu() -> None:
    if c.IDEA != "LAGU" or c.MIN_N != 30 or c.HOLD_DAYS != 17:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    spot, um = {}, {}
    y = entry - day
    _put(spot, y, 1, 100)
    _put(spot, y - 6 * day, 1, 110)
    _put(um, y, 1, 120)
    _put(um, y - 6 * day, 1, 100)
    _put(um, entry, 40, 1)
    _put(um, entry + 17 * day, 30, 1)
    py = missed - day
    _put(spot, py, 1, 130)
    _put(spot, py - 6 * day, 1, 100)
    _put(um, py, 1, 110)
    _put(um, py - 6 * day, 1, 100)
    _put(um, missed, 40, 1)
    _put(um, missed + 17 * day, 30, 1)
    trades = c.signal_trades(spot, um)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the USDT leg was sold without a lag")
    want = _short(Decimal(40), Decimal(30))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg short moved")
    wrecked = dict(um)
    row = wrecked[entry]
    wrecked[entry] = (row[0] * 10.0, row[1])
    if [t["entry_ms"] for t in c.signal_trades(spot, wrecked)] != [entry]:
        raise SystemExit("the entry open moved a sell")
    pool = {stamp for stamp, _exit in c.pool_spans(spot, um)}
    if entry not in pool or missed not in pool:
        raise SystemExit("the null dropped a seventeen-day short")
    if c.signal_trades({}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_lagu()
    print("fp251 pins ok")


if __name__ == "__main__":
    main()
