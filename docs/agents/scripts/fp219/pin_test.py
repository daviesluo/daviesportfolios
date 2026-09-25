from __future__ import annotations

"""Pins for the fp219 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _net(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (exit_px * (1 - fee)) / (entry * (1 + fee)) - 1


def test_the_quarterly_is_held_to_expiry() -> None:
    if c.IDEA != "XEXP" or c.MIN_N != 30 or c.DTE_MIN != 7 or c.DTE_MAX != 35:
        raise SystemExit("the idea moved")
    expiry, symbol = c.QUARTERS[0]
    near = expiry - 10 * c.fp5.DAY_MS
    far = expiry - 50 * c.fp5.DAY_MS
    too_close = expiry - 3 * c.fp5.DAY_MS
    if c.front(near) != (expiry, symbol):
        raise SystemExit("the front contract moved")
    book = {
        near: (100.0,),
        far: (70.0,),
        too_close: (50.0,),
        expiry: (80.0,),
        expiry + 6 * c.fp5.DAY_MS: (1.0,),
    }
    books = {symbol: book}
    trades = c.signal_trades(books)
    if len(trades) != 1 or trades[0]["entry_ms"] != near or trades[0]["exit_ms"] != expiry:
        raise SystemExit("the quarterly was not held to expiry")
    hold = (trades[0]["exit_ms"] - trades[0]["entry_ms"]) // c.fp5.DAY_MS
    if hold != 10:
        raise SystemExit("the hold is not the days to expiry")
    want = _net(Decimal(100), Decimal(80))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the one-leg fill moved")
    if abs(trades[0]["gross"] - (80.0 / 100.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the quarterly")
    if abs(trades[0]["gross"] - (1.0 / 100.0 - 1.0)) < 1e-9:
        raise SystemExit("a bar after expiry was the exit")
    spans = {entry for entry, _exit in c.pool_spans(books)}
    if near not in spans or far not in spans or too_close in spans:
        raise SystemExit("the null is not every hold of at least seven days")
    if c.signal_trades({symbol: {c.fp5.SCREEN_END_MS: (100.0,), expiry: (80.0,)}}):
        raise SystemExit("a 2024 open was an entry")


def main() -> None:
    test_the_quarterly_is_held_to_expiry()
    print("fp219 pins ok")


if __name__ == "__main__":
    main()
