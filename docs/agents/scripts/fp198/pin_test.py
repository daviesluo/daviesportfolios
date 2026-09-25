from __future__ import annotations

"""Pins for the fp198 rule. No file and no return from 2023 is read."""

import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as c


def _short(entry: Decimal, exit_px: Decimal) -> Decimal:
    fee = Decimal("0.001")
    return (entry * (1 - fee)) / (exit_px * (1 + fee)) - 1


def test_coin_oi() -> None:
    if c.IDEA != "COISH" or c.MIN_N != 30:
        raise SystemExit("the idea moved")
    signal = c.fp5.SCREEN_START_MS - c.fp5.DAY_MS
    entry = c.fp5.SCREEN_START_MS
    later = entry + c.fp5.DAY_MS
    um = {entry: (100.0, 80.0), later: (50.0, 40.0)}
    oi = {signal: (10.0, 12.0)}
    trades = c.signal_trades(um, oi)
    if len(trades) != 1 or trades[0]["entry_ms"] != entry or trades[0]["exit_ms"] != entry:
        raise SystemExit("the next perpetual session was not short")
    want = _short(Decimal(100), Decimal(80))
    if abs(trades[0]["net"] - float(want)) > 1e-12:
        raise SystemExit("the short fill moved")
    if abs(trades[0]["gross"] - (100.0 / 80.0 - 1.0)) > 1e-12:
        raise SystemExit("the gross is not the session short")
    if c.signal_trades(um, {signal: (10.0, 10.0)}):
        raise SystemExit("an equal print fired")
    if c.signal_trades(um, {signal: (12.0, 10.0)}):
        raise SystemExit("a falling print fired")
    late = c.fp5.SCREEN_END_MS - c.fp5.DAY_MS
    if c.signal_trades({c.fp5.SCREEN_END_MS: (100.0, 80.0)}, {late: (10.0, 12.0)}):
        raise SystemExit("a 2024 open was an entry")
    pool = c.pool_nets(um)
    if len(pool) != 2 or abs(pool[0] - float(want)) > 1e-12:
        raise SystemExit("the null is not every perpetual session short")


def main() -> None:
    test_coin_oi()
    print("fp198 pins ok")


if __name__ == "__main__":
    main()
