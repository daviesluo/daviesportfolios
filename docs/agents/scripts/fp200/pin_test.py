from __future__ import annotations

"""Pins for the fp200 rule. No file and no return from 2023 is read."""

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


def test_taker_spread() -> None:
    if c.IDEA != "TAKSP" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    # Shares on the signal day: UM 8/10, CM 3/10. Entry prices are a different day.
    um = {
        signal: (1.0, 1.0, 10.0, 8.0),
        entry: (200.0, 250.0, 10.0, 1.0),
        later: (80.0, 70.0, 10.0, 1.0),
    }
    cm = {
        signal: (1.0, 1.0, 10.0, 3.0),
        entry: (100.0, 110.0, 10.0, 9.0),
        later: (50.0, 40.0, 10.0, 9.0),
    }
    trades = c.signal_trades(cm, um)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry or trades[0]["exit_ms"] != entry:
        raise SystemExit("the next spread did not fill")
    want = _long(Decimal(100), Decimal(110)) + _short(Decimal(200), Decimal(250))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the spread fill moved")
    gross = (110.0 / 100.0 - 1.0) + (200.0 / 250.0 - 1.0)
    if abs(trades[0]["gross"] - gross) > 1e-12:
        raise SystemExit("the gross is not both legs")
    if abs(trades[0]["gross"] - (110.0 / 100.0 - 1.0)) < 1e-12:
        raise SystemExit("the short leg was dropped")
    if abs(trades[0]["gross"] - (8.0 / 3.0 - 1.0)) < 1e-12:
        raise SystemExit("the gross is the signal-day share")
    if c.signal_trades(cm, {**um, signal: (1.0, 1.0, 10.0, 3.0)}):
        raise SystemExit("an equal share fired")
    if c.signal_trades(cm, {**um, signal: (1.0, 1.0, 10.0, 2.0)}):
        raise SystemExit("a smaller USDT share fired")
    # Each share against one half is not the rule: UM 0.4 and CM 0.2 still fires.
    if len(c.signal_trades(cm, {**um, signal: (1.0, 1.0, 10.0, 4.0)})) != 1:
        raise SystemExit("a share under one half was refused")
    late = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if c.signal_trades(
        {late: (1.0, 1.0, 10.0, 3.0), c.fp5.SCREEN_END_MS: (100.0, 110.0, 10.0, 1.0)},
        {late: (1.0, 1.0, 10.0, 8.0), c.fp5.SCREEN_END_MS: (200.0, 250.0, 10.0, 1.0)},
    ):
        raise SystemExit("a 2024 open was an entry")
    pool = c.pool_nets(cm, um)
    if len(pool) != 2 or abs(pool[0] - float(want)) > 1e-12:
        raise SystemExit("the null is not the spread on every day")
    if abs(pool[0] - float(_long(Decimal(100), Decimal(110)))) < 1e-9:
        raise SystemExit("the null is an unconditional long")


def main() -> None:
    test_taker_spread()
    print("fp200 pins ok")


if __name__ == "__main__":
    main()
