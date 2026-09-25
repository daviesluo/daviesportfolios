from __future__ import annotations

"""Pins for the fp250 rule. No file and no return from 2023 is read."""

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



def test_fade() -> None:
    if c.IDEA != "FADE" or c.MIN_N != 30 or c.HOLD_DAYS != 26:
        raise SystemExit("the idea moved")
    day = c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS + 40 * day
    missed = entry + 80 * day
    um, cm = {}, {}
    y = entry - day
    _put(um, y - 20 * day, 1, 100)
    _put(um, y - 10 * day, 1, 130)
    _put(um, y, 1, 140)
    _put(cm, entry, 50, 1)
    _put(cm, entry + 26 * day, 40, 1)
    py = missed - day
    _put(um, py - 20 * day, 1, 100)
    _put(um, py - 10 * day, 1, 110)
    _put(um, py, 1, 140)
    _put(cm, missed, 50, 1)
    _put(cm, missed + 26 * day, 40, 1)
    trades = c.signal_trades(um, cm)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry:
        raise SystemExit("the coin-margined leg was sold without a slower rise")
    want = _short(Decimal(50), Decimal(40))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg short moved")
    wrecked = dict(cm)
    wrecked[entry] = (500.0, 1.0)
    if [t["entry_ms"] for t in c.signal_trades(um, wrecked)] != [entry]:
        raise SystemExit("the entry open moved a sell")
    pool = {stamp for stamp, _exit in c.pool_spans(um, cm)}
    if entry not in pool or missed not in pool:
        raise SystemExit("the null dropped a twenty-six-day short")
    if c.signal_trades({}, {c.fp5.SCREEN_END_MS: (100.0, 100.0)}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_fade()
    print("fp250 pins ok")


if __name__ == "__main__":
    main()
