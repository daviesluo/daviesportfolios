from __future__ import annotations

"""Pins for the fp256 rule. No file and no return from 2023 is read."""

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



def test_echo() -> None:
    if c.IDEA != "ECHO" or c.MIN_N != 30 or c.HOLD_DAYS != 25:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    cm, spot, um = {}, {}, {}
    y = entry - day
    _put(cm, y - 4 * day, 1, 120)
    _put(cm, y - 10 * day, 1, 100)
    _put(spot, y, 1, 110)
    _put(spot, y - 4 * day, 1, 100)
    _put(um, entry, 30, 1)
    _put(um, entry + 25 * day, 36, 1)
    py = missed - day
    _put(cm, py - 4 * day, 1, 90)
    _put(cm, py - 10 * day, 1, 100)
    _put(spot, py, 1, 110)
    _put(spot, py - 4 * day, 1, 100)
    _put(um, missed, 30, 1)
    _put(um, missed + 25 * day, 36, 1)
    trades = c.signal_trades(cm, spot, um)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the USDT leg was bought without the older rise")
    want = _long(Decimal(30), Decimal(36))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg long moved")
    wrecked = dict(um)
    wrecked[entry] = (300.0, 1.0)
    if [t["entry_ms"] for t in c.signal_trades(cm, spot, wrecked)] != [entry]:
        raise SystemExit("the entry open moved a buy")
    pool = {stamp for stamp, _exit in c.pool_spans(cm, spot, um)}
    if entry not in pool or missed not in pool:
        raise SystemExit("the null dropped a twenty-five-day long")
    if c.signal_trades({}, {}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_echo()
    print("fp256 pins ok")


if __name__ == "__main__":
    main()
